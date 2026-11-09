import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fixtures, readFixture } from './helpers/fixtures.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const action = path.resolve(__dirname, '../dist/index.js');
const sourceBase = readFixture('scenarios/source-change/base/Packages/App/Package.swift');
const sourceUpdated = readFixture('scenarios/source-change/head/Packages/App/Package.swift');
const projectWorkspace = 'App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm';
const globalBase = readFixture(`scenarios/source-change/base/${projectWorkspace}/Package.swift`);
const globalUpdated = readFixture(`scenarios/source-change/expected/${projectWorkspace}/Package.swift`);

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

test('action commits a sync, repeats as a no-op, and rejects a stale branch push', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-manifest-git-'));
  const remote = path.join(dir, 'remote.git');
  const work = path.join(dir, 'work');
  const eventPath = path.join(dir, 'event.json');
  const outputPath = path.join(dir, 'output');
  const src = 'Packages/App/Package.swift';
  const generated = 'App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.swift';
  const resolved = generated.replace('Package.swift', 'Package.resolved');
  const write = (file: string, content: string): void => {
    const absolute = path.join(work, file);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  };
  const run = (base: string, head: string, branch: string) => {
    fs.writeFileSync(eventPath, JSON.stringify({ pull_request: {
      base: { sha: base, repo: { full_name: 'owner/repo' } },
      head: { sha: head, ref: branch, repo: { full_name: 'owner/repo' } },
    } }));
    fs.writeFileSync(outputPath, '');
    return spawnSync(process.execPath, [action], { encoding: 'utf8', env: {
      ...process.env,
      GITHUB_WORKSPACE: work,
      GITHUB_REPOSITORY: 'owner/repo',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_OUTPUT: outputPath,
      'INPUT_RESOLVED-FILE': resolved,
      INPUT_MANIFESTS: src,
      INPUT_PROJECTS: '',
    } });
  };
  try {
    fs.mkdirSync(work);
    git(dir, 'init', '--bare', '--initial-branch=main', remote);
    git(dir, 'init', '--initial-branch=main', work);
    git(work, 'config', 'user.name', 'Test');
    git(work, 'config', 'user.email', 'test@example.com');
    write(src, sourceBase);
    write(generated, globalBase);
    write(resolved, readFixture('action/Package.resolved'));
    git(work, 'add', '.');
    git(work, 'commit', '-m', 'base');
    git(work, 'remote', 'add', 'origin', remote);
    git(work, 'push', 'origin', 'main');
    const base = git(work, 'rev-parse', 'HEAD');

    git(work, 'checkout', '-b', 'update');
    write(generated, globalUpdated);
    git(work, 'add', generated);
    git(work, 'commit', '-m', 'dependency update');
    git(work, 'push', 'origin', 'update');
    const head = git(work, 'rev-parse', 'HEAD');
    git(work, 'checkout', '--detach', head);
    const first = run(base, head, 'update');
    assert.equal(first.status, 0, first.stderr);
    assert.match(fs.readFileSync(outputPath, 'utf8'), /changed=true/);
    const synced = git(work, 'rev-parse', 'HEAD');
    assert.equal(git(work, 'show', `${synced}:${src}`), sourceUpdated.trim());
    assert.equal(git(dir, '--git-dir', remote, 'rev-parse', 'update'), synced);
    assert.equal(git(work, 'log', '-1', '--format=%B'), [
      'Sync global Swift manifest',
      '',
      '[dependabot skip]',
      '',
      'Generated-by: felixherrmann/xcode-global-manifest',
      `Global-manifest: ${generated}`,
      `Source-commit: ${head}`,
    ].join('\n'));

    const second = run(base, synced, 'update');
    assert.equal(second.status, 0, second.stderr);
    assert.equal(fs.readFileSync(outputPath, 'utf8'), 'changed=false\n');

    git(work, 'checkout', '-b', 'race', base);
    write(generated, globalUpdated);
    git(work, 'add', generated);
    git(work, 'commit', '-m', 'dependency update');
    git(work, 'push', 'origin', 'race');
    const staleHead = git(work, 'rev-parse', 'HEAD');
    write('README.txt', 'concurrent update\n');
    git(work, 'add', 'README.txt');
    git(work, 'commit', '-m', 'concurrent update');
    git(work, 'push', 'origin', 'race');
    const remoteHead = git(work, 'rev-parse', 'HEAD');
    git(work, 'checkout', '--detach', staleHead);
    const stale = run(base, staleHead, 'race');
    assert.notEqual(stale.status, 0);
    assert.equal(git(dir, '--git-dir', remote, 'rev-parse', 'race'), remoteHead);
    assert.equal(fs.readFileSync(outputPath, 'utf8'), '');

    git(work, 'checkout', '-b', 'symlink', base);
    const outside = path.join(dir, 'outside');
    fs.unlinkSync(path.join(work, generated));
    fs.symlinkSync(outside, path.join(work, generated));
    git(work, 'add', generated);
    git(work, 'commit', '-m', 'replace manifest with symlink');
    const symlinkHead = git(work, 'rev-parse', 'HEAD');
    git(work, 'checkout', '--detach', symlinkHead);
    const unsafe = run(base, symlinkHead, 'symlink');
    assert.notEqual(unsafe.status, 0);
    assert.match(unsafe.stderr, /symlink path is not allowed/);
    assert.equal(fs.existsSync(outside), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

for (const format of ['pbxproj', 'xcproj']) {
  test(`action expands a shallow checkout and creates the global manifest in a standalone workspace (${format})`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-manifest-workspace-'));
    const remote = path.join(dir, 'remote.git');
    const source = path.join(dir, 'source');
    const work = path.join(dir, 'work');
    const eventPath = path.join(dir, 'event.json');
    const outputPath = path.join(dir, 'output');
    const src = 'Packages/App/Package.swift';
    const project = `App.xcodeproj/project.${format}`;
    const generated = 'App.xcworkspace/xcshareddata/swiftpm/Package.swift';
    const resolved = generated.replace('Package.swift', 'Package.resolved');

    try {
      fs.cpSync(path.join(fixtures, 'scenarios/standalone-workspace/head'), source, { recursive: true });
      if (format === 'xcproj') {
        fs.unlinkSync(path.join(source, 'App.xcodeproj/project.pbxproj'));
        fs.writeFileSync(path.join(source, project), readFixture('templates/App.xcodeproj/project.xcproj'));
      }
      git(dir, 'init', '--bare', '--initial-branch=main', remote);
      git(dir, 'init', '--initial-branch=main', source);
      git(source, 'config', 'user.name', 'Test');
      git(source, 'config', 'user.email', 'test@example.com');
      git(source, 'add', '.');
      git(source, 'commit', '-m', 'base');
      git(source, 'remote', 'add', 'origin', remote);
      git(source, 'push', 'origin', 'main');
      const base = git(source, 'rev-parse', 'HEAD');
      git(source, 'checkout', '-b', 'workspace');
      fs.writeFileSync(path.join(source, 'workspace-change.txt'), 'Pull request change\n');
      git(source, 'add', 'workspace-change.txt');
      git(source, 'commit', '-m', 'workspace change');
      git(source, 'push', 'origin', 'workspace');
      const head = git(source, 'rev-parse', 'HEAD');
      git(dir, 'clone', '--depth=1', '--branch', 'workspace', `file://${remote}`, work);
      assert.equal(git(work, 'rev-parse', '--is-shallow-repository'), 'true');

      fs.writeFileSync(eventPath, JSON.stringify({ pull_request: {
        base: { sha: base, repo: { full_name: 'owner/repo' } },
        head: { sha: head, ref: 'workspace', repo: { full_name: 'owner/repo' } },
      } }));
      fs.writeFileSync(outputPath, '');
      const result = spawnSync(process.execPath, [action], { encoding: 'utf8', env: {
        ...process.env,
        GITHUB_WORKSPACE: work,
        GITHUB_REPOSITORY: 'owner/repo',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
        'INPUT_RESOLVED-FILE': resolved,
        INPUT_MANIFESTS: src,
        INPUT_PROJECTS: project,
      } });

      assert.equal(result.status, 0, result.stderr);
      assert.equal(git(work, 'rev-parse', '--is-shallow-repository'), 'false');
      assert.match(fs.readFileSync(outputPath, 'utf8'), /changed=true/);
      assert.equal(
        git(work, 'show', `HEAD:${generated}`),
        readFixture(`scenarios/standalone-workspace/expected/${generated}`).trim(),
      );
      assert.equal(git(dir, '--git-dir', remote, 'rev-parse', 'workspace'), git(work, 'rev-parse', 'HEAD'));
      assert.equal(git(work, 'log', '-1', '--format=%(trailers:only)'), [
        'Generated-by: felixherrmann/xcode-global-manifest',
        `Global-manifest: ${generated}`,
        `Source-commit: ${head}`,
      ].join('\n'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
