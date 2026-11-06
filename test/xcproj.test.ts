import assert from 'node:assert/strict';
import { test } from 'node:test';
import { xcodeProject } from '../dist/formats/xcode-project.js';
import { swiftManifest, generate } from '../dist/formats/swift.js';
import { synchronize } from '../dist/sync.js';
import { readFixture } from './helpers/fixtures.ts';
import type { Rule } from '../src/model.ts';

const file = 'App.xcodeproj/project.xcproj';
const url = 'https://github.com/example/Package.git';
const source = readFixture('templates/App.xcodeproj/project.xcproj');
const globalPath = 'workspace/Package.swift';
const exact = (value: string): Rule => ({ kind: 'exact', value });
const global = (value: string) => generate(new Map([[url, { rule: exact(value) }]]));
const project = (version: unknown) => JSON.stringify({ packages: [{ kind: 'remote', repository: url, version }] });

test('xcproj reads every Xcode requirement style, comments, trailing commas, and local packages', () => {
  const document = xcodeProject.read(readFixture('formats/all-requirements/App.xcodeproj/project.xcproj'), file);
  assert.deepEqual(document.dependencies.map(({ url, rule }) => [url, rule]), [
    ['https://example.com/exact.git', exact('1.2.3')],
    ['https://example.com/major.git', { kind: 'major', value: '1.2.3' }],
    ['https://example.com/minor.git', { kind: 'minor', value: '1.2.3' }],
    ['https://example.com/range.git', { kind: 'range', min: '1.0.0', max: '2.0.0' }],
    ['https://example.com/prerelease.git', { kind: 'range', min: '1.0.0-beta.1', max: '2.0.0' }],
    ['https://example.com/branch.git', { kind: 'branch', value: 'main' }],
    ['https://example.com/revision.git', { kind: 'revision', value: 'abcdef' }],
  ]);
  assert.equal(document.dependencies[0].line, 6);
  for (const text of ['{}', '{ "packages": [] }', '{ "packages": [{ "kind": "local", "path": "Local" }] }']) {
    assert.deepEqual(xcodeProject.read(text, file).dependencies, []);
  }
});

test('xcproj writes every requirement style, preserving traits and all surrounding text', () => {
  const cases: Array<[Rule, Record<string, string>]> = [
    [exact('2.0.0'), { version: '2.0.0' }],
    [{ kind: 'major', value: '2.0.0' }, { 'up-to-next-major-version': '2.0.0' }],
    [{ kind: 'minor', value: '2.0.0' }, { 'up-to-next-minor-version': '2.0.0' }],
    [{ kind: 'range', min: '2.0.0', max: '3.0.0' }, { 'version-range': '2.0.0..<3.0.0' }],
    [{ kind: 'range', min: '2.0.0-beta', max: '3.0.0' }, { 'version-range-min': '2.0.0-beta', 'version-range-max': '3.0.0' }],
    [{ kind: 'branch', value: 'release/"candidate"\\next\n\t😀' }, { branch: 'release/"candidate"\\next\n\t😀' }],
    [{ kind: 'revision', value: 'abcdef' }, { revision: 'abcdef' }],
  ];
  const document = xcodeProject.read(source, file);
  assert.equal(document.update(new Map([[url, exact('1.0.0')]])), source);
  assert.equal(document.update(new Map()), source);
  for (const [rule, constraint] of cases) {
    const result = document.update(new Map([[url, rule]]));
    assert.equal(result, source.replace('{ "version": "1.0.0" }', JSON.stringify(constraint)));
    assert.deepEqual(xcodeProject.read(result, file).dependencies[0].rule, rule);
  }
  assert.throws(() => document.update(new Map([[url, { kind: 'closed', min: '1.0.0', max: '2.0.0' }]])), /project.xcproj:9: inclusive Swift range/);
});

test('xcproj updates duplicate declarations and keeps JSON escapes and comment-like strings intact', () => {
  const escapedURL = 'https://example.com/\u00e9.git';
  const text = `{
    // Ignore { "packages": [] }
    "packages": [
      {"kind":"remote","repository":"https:\\/\\/example.com/\\u00e9.git","version":{"branch":"release\\u002fnext"}},
      {"kind":"remote","repository":${JSON.stringify(escapedURL)},"version":{"branch":"release/next"}},
    ],
    "other": {"version":"keep /* this */ // and ,}", "values":[null,true,false,-1.5e+2,]},
  }`;
  const document = xcodeProject.read(text, file);
  assert.deepEqual(document.dependencies.map(({ url, rule }) => [url, rule]), [
    [escapedURL, { kind: 'branch', value: 'release/next' }],
    [escapedURL, { kind: 'branch', value: 'release/next' }],
  ]);
  const result = document.update(new Map([[escapedURL, exact('2.0.0')]]));
  assert.equal(result, text.replace('{"branch":"release\\u002fnext"}', '{"version":"2.0.0"}')
    .replace('{"branch":"release/next"}', '{"version":"2.0.0"}'));
});

test('xcproj rejects malformed or unsupported dependencies with file locations', () => {
  for (const [text, message] of [
    ['[]', /expected an Xcode project object/],
    ['{"packages":{}}', /expected a packages array/],
    ['{"packages":[null]}', /expected a package object/],
    ['{"packages":[{"kind":"registry"}]}', /unsupported Xcode package kind/],
    [project(undefined), /expected a package version constraint/],
    [project(null), /expected a package version constraint/],
    [project('1.0.0'), /expected a package version constraint/],
    [project({}), /expected one Xcode version constraint/],
    [project({ branch: 'main', version: '1.0.0' }), /expected one Xcode version constraint/],
    [project({ version: 1 }), /expected a nonempty package string/],
    [project({ future: '1.0.0' }), /unsupported Xcode version constraint/],
    [project({ 'version-range': '1.0.0...2.0.0' }), /invalid Xcode version range/],
    [project({ 'version-range': '1..<2..<3' }), /invalid Xcode version range/],
    [project({ 'version-range-min': '1.0.0' }), /unsupported Xcode version constraint/],
    [project({ version: '1.0.0' }).replace('"repository":', '"repository":null,"unused":'), /expected a nonempty package string/],
  ] as const) {
    assert.throws(() => xcodeProject.read(text, file), error => {
      assert.match((error as Error).message, /^App\.xcodeproj\/project\.xcproj:\d+:/);
      assert.match((error as Error).message, message);
      return true;
    });
  }
});

test('xcproj rejects malformed JSON and duplicate keys instead of losing dependencies', () => {
  for (const text of [
    '{"packages":[],"packages":[]}',
    project({ version: '1.0.0' }).replace('"version":"1.0.0"', '"version":"1.0.0","version":"2.0.0"'),
    '{"packages":[]', '{"packages": [}', '{"packages": [,]}', '{} trailing',
    '{"x":"\\q"}', '{"x":"unterminated}', '{/* unterminated', '{"x":01}', '{"x":true false}',
    '{"x" 1}', '{"x":1 "y":2}', '{"x":"line\nbreak"}',
  ]) {
    assert.throws(() => xcodeProject.read(text, file), /project\.xcproj:\d+:/);
  }
});

test('xcproj synchronizes both directions, detects conflicts, and supports mixed project formats', () => {
  const swiftPath = 'Packages/App/Package.swift';
  const pbxPath = 'Other.xcodeproj/project.pbxproj';
  const sources = [
    { file, format: xcodeProject },
    { file: swiftPath, format: swiftManifest },
    { file: pbxPath, format: xcodeProject },
  ];
  const base = {
    [file]: source, [swiftPath]: global('1.0.0'), [globalPath]: global('1.0.0'),
    [pbxPath]: readFixture('templates/App.xcodeproj/project.pbxproj'),
  };
  const head = { ...base, [globalPath]: global('2.0.0') };
  const updates = synchronize({ base, head, sources, globalPath });
  assert.deepEqual(Object.keys(updates).sort(), [file, swiftPath, pbxPath].sort());
  for (const { file, format } of sources) assert.deepEqual(format.read(updates[file], file).dependencies[0].rule, exact('2.0.0'));
  assert.deepEqual(synchronize({ base, head: { ...head, ...updates }, sources, globalPath }), {});

  const projectOnly = [{ file, format: xcodeProject }];
  const edited = { ...base, [file]: source.replace('"1.0.0"', '"3.0.0"') };
  assert.deepEqual(synchronize({ base, head: edited, sources: projectOnly, globalPath }), { [globalPath]: global('3.0.0') });
  assert.throws(() => synchronize({ base, head: { ...edited, [globalPath]: global('2.0.0') }, sources: projectOnly, globalPath }), /sync conflict/);
  const firstRun = { [file]: source };
  assert.deepEqual(synchronize({ base: firstRun, head: firstRun, sources: projectOnly, globalPath }), { [globalPath]: global('1.0.0') });
});
