import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseProject } from '../dist/formats/pbxproj.js';
import { generate, parseSwift, swiftManifest } from '../dist/formats/swift.js';
import { xcodeProject } from '../dist/formats/xcode-project.js';
import { synchronize } from '../dist/sync.js';
import { readFixture } from './helpers/fixtures.ts';
import type { Files } from '../src/model.ts';

const url = 'https://github.com/example/Package.git';
const other = 'https://github.com/example/Other';
const manifestTemplate = readFixture('templates/Package.swift');
const twoPackagesTemplate = readFixture('templates/TwoPackages.swift');
const projectTemplate = readFixture('templates/App.xcodeproj/project.pbxproj');
const manifest = (rule: string, extra = ''): string => manifestTemplate.replace('exact: "1.0.0"', `${rule}${extra}`);
const two = (a: string, b: string): string => twoPackagesTemplate
  .replace('exact: "1.0.0"', `exact: "${a}"`)
  .replace('exact: "2.0.0"', `exact: "${b}"`);
const pbx = (rule: string): string => projectTemplate.replace(
  '\t\t\t\tkind = exactVersion;\n\t\t\t\tversion = 1.0.0;',
  rule.split('; ').map(field => `\t\t\t\t${field};`).join('\n'),
);
const sync = (
  before: string,
  after: string,
  globalBefore = before,
  globalAfter = globalBefore,
  projectBefore?: string,
  projectAfter = projectBefore,
): Files => {
  const base: Files = { 'Packages/App/Package.swift': before, 'workspace/Package.swift': globalBefore };
  const head: Files = { 'Packages/App/Package.swift': after, 'workspace/Package.swift': globalAfter };
  const projectPaths = projectBefore === undefined ? [] : ['App.xcodeproj/project.pbxproj'];
  if (projectBefore !== undefined) {
    base[projectPaths[0]] = projectBefore;
    head[projectPaths[0]] = projectAfter ?? projectBefore;
  }
  const sources = [
    { file: 'Packages/App/Package.swift', format: swiftManifest },
    ...projectPaths.map(file => ({ file, format: xcodeProject })),
  ];
  return synchronize({ base, head, globalPath: 'workspace/Package.swift', sources });
};

test('parses common Swift requirement forms from a Package.swift file', () => {
  const declarations = parseSwift(readFixture('formats/all-requirements/Package.swift'), 'Package.swift');
  assert.deepEqual(declarations.map(({ url, rule }) => [url, rule]), [
    ['https://example.com/exact.git', { kind: 'exact', value: '1.2.3' }],
    ['https://example.com/from.git', { kind: 'major', value: '1.2.3' }],
    ['https://example.com/minor.git', { kind: 'minor', value: '1.2.3' }],
    ['https://example.com/major.git', { kind: 'major', value: '1.2.3' }],
    ['https://example.com/range.git', { kind: 'range', min: '1.0.0', max: '2.0.0' }],
    ['https://example.com/closed.git', { kind: 'closed', min: '1.0.0', max: '2.0.0' }],
    ['https://example.com/branch.git', { kind: 'branch', value: 'main' }],
    ['https://example.com/revision.git', { kind: 'revision', value: 'abcdef' }],
    ['https://example.com/exact-expression.git', { kind: 'exact', value: '1.2.3' }],
    ['https://example.com/branch-expression.git', { kind: 'branch', value: 'main' }],
    ['https://example.com/revision-expression.git', { kind: 'revision', value: 'abcdef' }],
  ]);
});

test('parses common Xcode requirement forms from an xcodeproj file', () => {
  const declarations = parseProject(
    readFixture('formats/all-requirements/App.xcodeproj/project.pbxproj'),
    'App.xcodeproj/project.pbxproj',
  );
  assert.deepEqual(declarations.map(({ url, rule }) => [url, rule]), [
    ['https://example.com/exact.git', { kind: 'exact', value: '1.2.3' }],
    ['https://example.com/major.git', { kind: 'major', value: '1.2.3' }],
    ['https://example.com/minor.git', { kind: 'minor', value: '1.2.3' }],
    ['https://example.com/range.git', { kind: 'range', min: '1.0.0', max: '2.0.0' }],
    ['https://example.com/branch.git', { kind: 'branch', value: 'main' }],
    ['https://example.com/revision.git', { kind: 'revision', value: 'abcdef' }],
  ]);
});

test('source edits regenerate a sorted global manifest; repeated sync is a no-op', () => {
  const before = manifest('exact: "1.0.0"');
  const after = manifest('exact: "1.1.0"');
  const global = generate(new Map([[url, { rule: { kind: 'exact', value: '1.0.0' } }]]));
  const updates = sync(before, after, global);
  assert.match(updates['workspace/Package.swift'], /exact: "1\.1\.0"/);
  assert.deepEqual(sync(after, after, updates['workspace/Package.swift']), {});
});

test('changing only the configured tools version updates the global manifest; repeated sync is a no-op', () => {
  const source = manifest('exact: "1.0.0"');
  const global = generate(new Map([[url, { rule: { kind: 'exact', value: '1.0.0' } }]]));
  const files = { 'Packages/App/Package.swift': source, 'workspace/Package.swift': global };
  const input = {
    base: files,
    head: files,
    globalPath: 'workspace/Package.swift',
    sources: [{ file: 'Packages/App/Package.swift', format: swiftManifest }],
    swiftToolsVersion: '6.0',
  };
  const updates = synchronize(input);
  assert.deepEqual(updates, { 'workspace/Package.swift': global.replace('swift-tools-version: 5.9', 'swift-tools-version: 6.0') });
  assert.deepEqual(synchronize({ ...input, head: { ...files, ...updates } }), {});
});

test('the configured tools version is used for first generation and dependency changes', () => {
  const source = manifest('exact: "1.0.0"');
  const files = { 'Packages/App/Package.swift': source };
  const input = {
    base: files,
    head: files,
    globalPath: 'workspace/Package.swift',
    sources: [{ file: 'Packages/App/Package.swift', format: swiftManifest }],
    swiftToolsVersion: '6.0.1',
  };
  const created = synchronize(input);
  assert.match(created['workspace/Package.swift'], /^\/\/ swift-tools-version: 6\.0\.1\n/);
  const base = { ...files, ...created };
  const updates = synchronize({ ...input, base, head: { ...base, 'Packages/App/Package.swift': manifest('exact: "1.1.0"') } });
  assert.match(updates['workspace/Package.swift'], /^\/\/ swift-tools-version: 6\.0\.1\n/);
  assert.match(updates['workspace/Package.swift'], /exact: "1\.1\.0"/);
});

test('global edits change existing source requirements while retaining source-only arguments', () => {
  const before = manifest('exact: "1.0.0"', ', traits: ["Minimal"]');
  const global = generate(new Map([[url, { rule: { kind: 'exact', value: '1.0.0' } }]]));
  const edited = global.replace('exact: "1.0.0"', 'branch: "release"');
  const updates = sync(before, before, global, edited);
  assert.match(updates['Packages/App/Package.swift'], /branch: "release", traits: \["Minimal"\]/);
  assert.equal(updates['workspace/Package.swift'], undefined);
});

test('changes to separate packages on opposite sides merge', () => {
  const before = two('1.0.0', '2.0.0');
  const global = generate(new Map([
    [url, { rule: { kind: 'exact', value: '1.0.0' } }],
    [other, { rule: { kind: 'exact', value: '2.0.0' } }],
  ]));
  const updates = sync(before, two('1.0.0', '2.1.0'), global, global.replace('exact: "1.0.0"', 'exact: "1.1.0"'));
  assert.match(updates['Packages/App/Package.swift'], /exact: "1\.1\.0"/);
  assert.match(updates['workspace/Package.swift'], /exact: "2\.1\.0"/);
});

test('same-package simultaneous edits conflict, while identical edits succeed', () => {
  const before = manifest('exact: "1.0.0"');
  const global = generate(new Map([[url, { rule: { kind: 'exact', value: '1.0.0' } }]]));
  assert.throws(() => sync(before, manifest('exact: "1.1.0"'), global, global.replace('1.0.0', '1.2.0')), /sync conflict.*Package/);
  assert.deepEqual(sync(before, manifest('exact: "1.1.0"'), global, global.replace('1.0.0', '1.1.0')), {});
});

test('duplicate source rules and stale base state fail before writing', () => {
  const before = manifest('exact: "1.0.0"');
  const global = generate(new Map([[url, { rule: { kind: 'exact', value: '1.0.0' } }]]));
  const project = pbx('kind = exactVersion; version = 1.0.0');
  assert.throws(() => sync(before, manifest('exact: "1.1.0"'), global, global, project), /conflicting requirements/);
  assert.throws(() => sync(before, before, global.replace('1.0.0', '2.0.0')), /base commit is out of sync/);
});

test('global inclusive range cannot be pushed into an Xcode project', () => {
  const before = manifest('exact: "1.0.0"');
  const global = generate(new Map([[url, { rule: { kind: 'exact', value: '1.0.0' } }]]));
  assert.throws(() => sync(before, before, global, global.replace('exact: "1.0.0"', '"1.0.0"..."2.0.0"'), pbx('kind = exactVersion; version = 1.0.0')), /inclusive Swift range/);
});

test('global rule-kind changes update both Swift and Xcode occurrences', () => {
  const before = manifest('exact: "1.0.0"');
  const global = generate(new Map([[url, { rule: { kind: 'exact', value: '1.0.0' } }]]));
  const project = pbx('kind = exactVersion; version = 1.0.0');
  const edited = global.replace('exact: "1.0.0"', '"1.0.0"..<"2.0.0"');
  const updates = sync(before, before, global, edited, project);
  assert.match(updates['Packages/App/Package.swift'], /"1\.0\.0"\.\.<"2\.0\.0"/);
  assert.deepEqual(parseProject(updates['App.xcodeproj/project.pbxproj'], 'project')[0].rule, { kind: 'range', min: '1.0.0', max: '2.0.0' });
  assert.match(updates['App.xcodeproj/project.pbxproj'], /repositoryURL = "https:\/\/github.com\/example\/Package.git"/);
});

test('source additions and removals update the global set', () => {
  const before = manifest('exact: "1.0.0"');
  const global = generate(new Map([[url, { rule: { kind: 'exact', value: '1.0.0' } }]]));
  const added = before.replace('  .package(path:', `  .package(url: "${other}", branch: "main"),\n  .package(path:`);
  assert.equal(parseSwift(sync(before, added, global)['workspace/Package.swift'], 'global').length, 2);
  const removed = before.replace(/  \.package\(url:.*\n/, '');
  assert.equal(parseSwift(sync(before, removed, global)['workspace/Package.swift'], 'global').length, 0);
});

test('comments and escaped strings are parsed without treating commented declarations as dependencies', () => {
  const text = manifest('exact: "1.0.0"').replace('  .package(path:', `  // .package(url: "https://ignored", exact: "9.0.0")\n  /* nested /* comment */ block */\n  .package(path:`);
  assert.equal(parseSwift(text, 'x').length, 1);
  const quoted = manifest('branch: "release\\\"candidate"');
  const rule = parseSwift(quoted, 'x')[0]?.rule;
  assert.ok(rule && 'value' in rule);
  assert.equal(rule.value, 'release"candidate');
});

test('ambiguous package declarations and project fields fail with locations', () => {
  const before = manifest('exact: "1.0.0"');
  assert.throws(() => parseSwift(before.replace('exact: "1.0.0"', 'exact: "1.0.0", from: "2.0.0"'), 'App/Package.swift'), /App\/Package.swift:7: expected one package requirement/);
  assert.throws(() => parseSwift(before.replace(`url: "${url}"`, `url: "${url}", url: "${other}"`), 'App/Package.swift'), /App\/Package.swift:7: expected one package identity/);
  assert.throws(() => parseProject(pbx('kind = exactVersion; kind = branch; version = 1.0.0'), 'App.xcodeproj/project.pbxproj'), /duplicate project field kind/);
  assert.throws(() => parseProject(pbx('kind = exactVersion; version = "1.0\\q"'), 'App.xcodeproj/project.pbxproj'), /App\.xcodeproj\/project.pbxproj:14: unsupported string escape/);
});

test('new global manifest is generated; nonliteral dependencies fail visibly', () => {
  const before = manifest('exact: "1.0.0"');
  const updates: Files = synchronize({ base: { 'Packages/App/Package.swift': before }, head: { 'Packages/App/Package.swift': before }, globalPath: 'workspace/Package.swift', sources: [{ file: 'Packages/App/Package.swift', format: swiftManifest }] });
  assert.match(updates['workspace/Package.swift'], /exact: "1\.0\.0"/);
  assert.throws(() => parseSwift(before.replace('dependencies: [', 'dependencies: external + ['), 'App/Package.swift'), /dependencies must be a literal array/);
  assert.throws(() => parseSwift(`${before}package.dependencies.append(.package(url: "${other}", exact: "2.0.0"))`, 'App/Package.swift'), /outside the literal dependencies array/);
});

test('global additions and removals are rejected', () => {
  const before = manifest('exact: "1.0.0"');
  const global = generate(new Map([[url, { rule: { kind: 'exact', value: '1.0.0' } }]]));
  const added = global.replace('    ]', `        .package(url: "${other}", exact: "2.0.0"),\n    ]`);
  assert.throws(() => sync(before, before, global, added), /add or remove/);
  assert.throws(() => sync(before, before, global, global.replace(/        \.package.*\n/, '')), /add or remove/);
});
