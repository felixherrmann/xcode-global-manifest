import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generate, swiftManifest } from '../dist/formats/swift.js';
import { xcodeProject } from '../dist/formats/xcode-project.js';
import { synchronize } from '../dist/sync.js';
import { readFixture } from './helpers/fixtures.ts';
import type { DependencyFormat } from '../src/formats/document.ts';
import type { Rule } from '../src/model.ts';

const url = 'https://github.com/example/Package.git';
const projectPath = 'App.xcodeproj/project.json';
const globalPath = 'workspace/Package.swift';
const exact = (value: string): Rule => ({ kind: 'exact', value });
const global = (version: string): string => generate(new Map([[url, { rule: exact(version) }]]));
const project = (version: string): string => JSON.stringify({ packages: [{ url, requirement: exact(version) }], settings: { untouched: true } });

// A test-only schema, not a prediction of Xcode's JSON format. No text ranges required.
const jsonFormat: DependencyFormat = {
  read(source, file) {
    const data = JSON.parse(source) as {
      packages: Array<{ url: string; requirement: Rule }>;
      settings: { untouched: boolean };
    };
    return {
      file,
      dependencies: data.packages.map(({ url, requirement }) => ({ url, rule: requirement, file, line: 1 })),
      update(requirements) {
        return JSON.stringify({
          ...data,
          packages: data.packages.map(dependency => ({
            ...dependency,
            requirement: requirements.get(dependency.url) ?? dependency.requirement,
          })),
        });
      },
    };
  },
};

test('a structured project adapter supports both sync directions without changing the sync engine', () => {
  const sources = [{ file: projectPath, format: jsonFormat }];
  const base = { [projectPath]: project('1.0.0'), [globalPath]: global('1.0.0') };
  const head = { ...base, [globalPath]: global('2.0.0') };
  const updates = synchronize({ base, head, sources, globalPath });
  assert.deepEqual(updates, { [projectPath]: project('2.0.0') });
  assert.deepEqual(synchronize({ base, head: { ...head, ...updates }, sources, globalPath }), {});

  const sourceEdit = { ...base, [projectPath]: project('3.0.0') };
  assert.deepEqual(synchronize({ base, head: sourceEdit, sources, globalPath }), { [globalPath]: global('3.0.0') });
  assert.throws(() => synchronize({
    base, head: { ...sourceEdit, [globalPath]: global('2.0.0') }, sources, globalPath,
  }), /sync conflict/);
});

test('format selection can change between base and head snapshots', () => {
  const file = 'source';
  const migratingFormat: DependencyFormat = {
    read(source, file) {
      return (source.startsWith('{') ? jsonFormat : swiftManifest).read(source, file);
    },
  };
  const base = { [file]: global('1.0.0'), [globalPath]: global('1.0.0') };
  const head = { [file]: project('1.0.0'), [globalPath]: global('2.0.0') };
  const updates = synchronize({ base, head, sources: [{ file, format: migratingFormat }], globalPath });
  assert.deepEqual(updates, { [file]: project('2.0.0') });
});

test('Swift document updates all matching occurrences while preserving other text', () => {
  const source = readFixture('scenarios/global-change/base/Packages/App/Package.swift');
  const fixtureURL = 'https://github.com/apple/swift-algorithms.git';
  const document = swiftManifest.read(source, 'Package.swift');
  const requirements = new Map<string, Rule>([[fixtureURL, { kind: 'branch', value: 'a-much-longer-branch' }]]);
  const expected = source.replace('exact: "1.1.0"', 'branch: "a-much-longer-branch"')
    .replace('.exact("1.1.0")', 'branch: "a-much-longer-branch"');
  assert.equal(document.update(requirements), expected);
  assert.equal(document.update(new Map([[fixtureURL, exact('1.1.0')]])), source);
});

test('unsupported project extensions are rejected', () => {
  assert.throws(() => xcodeProject.read(project('1.0.0'), projectPath), /unsupported Xcode project format/);
});
