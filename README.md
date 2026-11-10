# Xcode Global Manifest

Use Dependabot to update Swift packages that are declared across Xcode projects and `Package.swift` files in your repository.

Dependabot needs a Swift package manifest to update, while Xcode can store package requirements in project files. Xcode Global Manifest gives Dependabot one generated manifest and keeps it in sync with the package requirements your project actually uses. A Dependabot pull request can then update all matching declarations together.

## What you get

- One generated `Package.swift` beside your Xcode workspace's `Package.resolved`.
- Dependabot updates copied back to your selected Swift manifests and Xcode projects.
- Changes made by developers in those source files reflected in the generated manifest.
- A sync commit added directly to the same pull request when files need to change.

The action does not resolve packages or edit `Package.resolved`. Xcode and Dependabot remain responsible for the resolved versions.

## Setup

Before you start, resolve your packages in Xcode and commit the workspace's shared `Package.resolved`. The action reads this file but does not create it.

### 1. Add the workflow

Create `.github/workflows/xcode-global-manifest.yml`:

```yaml
name: Xcode Global Manifest

on:
  pull_request_target:

permissions:
  contents: write

jobs:
  sync:
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          ref: ${{ github.event.pull_request.head.sha }}

      - uses: felixherrmann/xcode-global-manifest@v1
        with:
          resolved-file: App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
          sources: |
            Packages/Core/Package.swift
            Packages/Feature/Package.swift
            App.xcodeproj/project.pbxproj
```

Replace the paths with paths from your repository. The action fetches only the Git history it needs to distinguish source changes from Dependabot changes.

Both the property list `project.pbxproj` and JSON `project.xcproj` formats are supported. For a JSON project, use `App.xcodeproj/project.xcproj` under `sources`. You can list Swift manifests and projects using either format together; the action selects the parser from each filename. The workspace and `Package.resolved` paths are the same for both project formats.

The workflow must use `pull_request_target` because it commits the synchronized files to the pull request branch. It only accepts pull requests whose branch belongs to the same repository. Do not add steps that build, test, install dependencies, or otherwise execute code from the checked-out pull request in this privileged workflow. See GitHub's guidance on [secure use of `pull_request_target`](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target).

If your repository or organization restricts `pull_request_target`, allow this event in its GitHub Actions policy before using the workflow.

#### Standalone Xcode workspaces

If you use a standalone Xcode workspace, point `resolved-file` at its shared resolution file and list the member projects explicitly:

```yaml
- uses: felixherrmann/xcode-global-manifest@v1
  with:
    resolved-file: App.xcworkspace/xcshareddata/swiftpm/Package.resolved
    sources: |
      Packages/Core/Package.swift
      Packages/Feature/Package.swift
      App.xcodeproj/project.pbxproj
      Framework.xcodeproj/project.pbxproj
```

An `.xcworkspace` references its member projects in `contents.xcworkspacedata`. The action does not discover those projects automatically, so list each project's `project.pbxproj` or `project.xcproj` explicitly under `sources`.

### 2. Point Dependabot at the generated manifest

Add a Swift entry to `.github/dependabot.yml`. Its `directory` must be the directory containing the `Package.resolved` from `resolved-file`:

```yaml
version: 2
updates:
  - package-ecosystem: swift
    directory: /App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm
    schedule:
      interval: weekly
```

See GitHub's [Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference) for scheduling, grouping, registries, and other update options.

### 3. Create the first global manifest

Merge the workflow, then open a pull request from a branch in the same repository. The first run creates `Package.swift` beside `Package.resolved` and commits it to that pull request. Merge that generated file into your default branch so Dependabot can discover it.

Keep both the generated `Package.swift` and the shared `Package.resolved` under version control.

## Inputs

| Input | Required | Description |
| --- | --- | --- |
| `resolved-file` | Yes | Repository-relative path to the shared `Package.resolved` in a standalone `.xcworkspace` or a project's internal workspace. The generated `Package.swift` is placed in the same directory. |
| `sources` | Yes | Newline-separated, repository-relative paths to `Package.swift`, `project.pbxproj`, or `project.xcproj` files whose dependencies should be included. |
| `swift-tools-version` | No | Swift tools version written to the generated manifest's `// swift-tools-version:` header. Defaults to `5.9`; accepts `major.minor` or `major.minor.patch`, such as `'6.0'` or `'6.0.1'`. |

All paths must point to regular files inside the repository. At least one path is required under `sources`; you can list Swift manifests, Xcode projects, or both. Do not include the generated manifest.

To select a different tools version, add `swift-tools-version: '6.0'` under the action's `with:` block. Changing this input updates the generated manifest even when dependencies are unchanged. Source manifests keep their own tools versions.

## Outputs

| Output | Description |
| --- | --- |
| `changed` | `true` when the action created and pushed a sync commit; otherwise `false`. |
| `commit-sha` | SHA of the sync commit when `changed` is `true`. |

Give the action step an `id` if a later step needs an output:

```yaml
- id: manifest
  uses: felixherrmann/xcode-global-manifest@v1
  with:
    resolved-file: App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
    sources: Packages/Core/Package.swift

- if: steps.manifest.outputs.changed == 'true'
  run: echo "The manifest was synchronized"
```

## Day-to-day use

Add or remove packages in their real source location: a selected `Package.swift` or Xcode project. Do not add or remove packages in the generated manifest. The action will regenerate it in the pull request.

When Dependabot opens an update pull request, it changes the generated manifest and `Package.resolved`. The action copies the new requirement into every selected source that declares that package and commits the result to the Dependabot branch.

Sync commits use `Sync global Swift manifest` as their subject. The body contains `[dependabot skip]` so Dependabot can replace the generated commit when rebasing its pull request. The `Generated-by`, `Global-manifest`, and `Source-commit` Git trailers identify the action, the generated manifest path, and the pull request head SHA that was synchronized.

If a developer and Dependabot change different packages in the same pull request, both changes are kept. If both change the same package incompatibly, the action stops and asks you to resolve the conflict instead of choosing one silently.

## Supported dependencies

The generated manifest includes remote URL packages using these requirement styles:

- Exact versions
- Up-to-next-major and up-to-next-minor ranges
- Custom version ranges
- Branches
- Revisions

Local path and registry packages stay in their source files and are not added to the generated manifest. Dependabot does not update revision pins.

Package declarations in Swift manifests must be literal `.package(...)` entries inside the manifest's literal `dependencies` array. If the same URL is declared in more than one selected source, its requirements must agree.

Closed ranges can be read from Swift manifests, but cannot be copied into an Xcode project because Xcode stores an exclusive upper bound.

## Troubleshooting

- **The action says the checkout is not at the PR head.** Keep `ref: ${{ github.event.pull_request.head.sha }}` on the checkout step.
- **Git cannot fetch the comparison history.** Keep the checkout action's persisted credentials enabled and confirm that `origin` can read the repository.
- **The generated manifest never appears.** The workflow must already exist on the default branch before a `pull_request_target` run can use it. Merge the workflow, then open a same-repository pull request.
- **The workflow never starts.** Check whether your repository or organization Actions policy allows `pull_request_target`.
- **A fork pull request is skipped.** This is expected. The action only pushes to branches in the same repository.
- **The sync commit cannot be pushed.** Confirm that the workflow has `contents: write` permission and that your branch rules allow the GitHub Actions bot to update the pull request branch.
- **The action reports a sync conflict.** Choose the intended requirement in the source file and generated manifest, or revert one side of the conflicting change, then rerun the job.
