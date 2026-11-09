import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { readConfig } from '../dist/action/config.js';
import { swiftManifest } from '../dist/formats/swift.js';
import { xcodeProject } from '../dist/formats/xcode-project.js';

const resolvedPath = 'App.xcworkspace/xcshareddata/swiftpm/Package.resolved';
const globalPath = 'App.xcworkspace/xcshareddata/swiftpm/Package.swift';

function config(inputs: Record<string, string | undefined>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'global-manifest-config-'));
  const eventPath = path.join(dir, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify({ pull_request: {
    base: { sha: 'base', repo: { full_name: 'owner/repo' } },
    head: { sha: 'head', ref: 'update', repo: { full_name: 'owner/repo' } },
  } }));
  const env = {
    GITHUB_WORKSPACE: dir,
    GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_OUTPUT: path.join(dir, 'output'),
    'INPUT_RESOLVED-FILE': resolvedPath,
    INPUT_SOURCES: 'Package.swift',
    ...inputs,
  };
  const previous = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return readConfig();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('sources select formats and trim and deduplicate mixed input paths', () => {
  const result = config({ INPUT_SOURCES: '\n App.xcodeproj/project.xcproj \r\nPackage.swift\n\nFramework.xcodeproj/project.pbxproj\nPackage.swift\n' });
  assert.deepEqual(result.sources, [
    { file: 'App.xcodeproj/project.xcproj', format: xcodeProject },
    { file: 'Package.swift', format: swiftManifest },
    { file: 'Framework.xcodeproj/project.pbxproj', format: xcodeProject },
  ]);
  assert.deepEqual(result.watchedPaths, [...result.sources.map(source => source.file), globalPath]);
  assert.equal(result.globalPath, globalPath);
});

for (const extension of ['pbxproj', 'xcproj']) {
  test(`sources accept an Xcode project without a Swift manifest (${extension})`, () => {
    const file = `App.xcodeproj/project.${extension}`;
    assert.deepEqual(config({ INPUT_SOURCES: file }).sources, [{ file, format: xcodeProject }]);
  });
}

test('sources accept only Swift manifests', () => {
  assert.deepEqual(config({ INPUT_SOURCES: 'Packages/Core/Package.swift' }).sources, [
    { file: 'Packages/Core/Package.swift', format: swiftManifest },
  ]);
});

test('configuration requires resolved-file and a nonempty sources input', () => {
  for (const value of [undefined, '', ' \n\r\n ']) {
    assert.throws(() => config({ INPUT_SOURCES: value }), /resolved-file and at least one source are required/);
  }
  assert.throws(() => config({ 'INPUT_RESOLVED-FILE': undefined }), /resolved-file and at least one source are required/);
});

test('sources reject the generated manifest', () => {
  assert.throws(() => config({ INPUT_SOURCES: globalPath }), /the generated manifest cannot be a source/);
});

test('sources reject unsupported filenames', () => {
  for (const file of ['Other.swift', 'project.json', 'App.xcodeproj', 'App.xcworkspace']) {
    assert.throws(() => config({ INPUT_SOURCES: file }), /unsupported source format/);
  }
});
