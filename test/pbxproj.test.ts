import assert from 'node:assert/strict';
import { test } from 'node:test';
import { xcodeProject } from '../dist/formats/xcode-project.js';
import { readFixture } from './helpers/fixtures.ts';
import type { Rule } from '../src/model.ts';

const file = 'App.xcodeproj/project.pbxproj';
const url = 'https://github.com/example/Package.git';
const source = readFixture('templates/App.xcodeproj/project.pbxproj');
const original = '\t\t\t\tkind = exactVersion;\n\t\t\t\tversion = 1.0.0;';

test('pbxproj writes ordinary requirement values without quotes, matching Xcode', () => {
  const cases: Array<[Rule, string[]]> = [
    [{ kind: 'exact', value: '1.17.0' }, ['kind = exactVersion', 'version = 1.17.0']],
    [{ kind: 'major', value: '2.0.0' }, ['kind = upToNextMajorVersion', 'minimumVersion = 2.0.0']],
    [{ kind: 'minor', value: '2.1.0' }, ['kind = upToNextMinorVersion', 'minimumVersion = 2.1.0']],
    [{ kind: 'range', min: '2.0.0', max: '3.0.0' }, ['kind = versionRange', 'minimumVersion = 2.0.0', 'maximumVersion = 3.0.0']],
    [{ kind: 'branch', value: 'release/next' }, ['kind = branch', 'branch = release/next']],
    [{ kind: 'revision', value: 'abcdef123456' }, ['kind = revision', 'revision = abcdef123456']],
    [{ kind: 'exact', value: '2.0.0-beta.1' }, ['kind = exactVersion', 'version = "2.0.0-beta.1"']],
    [{ kind: 'range', min: '2.0.0-beta.1', max: '3.0.0' }, ['kind = versionRange', 'minimumVersion = "2.0.0-beta.1"', 'maximumVersion = 3.0.0']],
  ];
  const document = xcodeProject.read(source, file);
  for (const [rule, fields] of cases) {
    const result = document.update(new Map([[url, rule]]));
    assert.equal(result, source.replace(original, fields.map(field => `\t\t\t\t${field};`).join('\n')));
    assert.deepEqual(xcodeProject.read(result, file).dependencies[0].rule, rule);
  }
});

test('pbxproj quotes and escapes branch names that cannot be written as bare scalars', () => {
  const cases = [
    ['', '""'],
    ['release-next', '"release-next"'],
    ['release candidate', '"release candidate"'],
    ['release//next', '"release//next"'],
    ['release/*next*/', '"release/*next*/"'],
    ['feature___next', '"feature___next"'],
    ['release"next', '"release\\"next"'],
    ['release\\next', '"release\\\\next"'],
    ['release\nnext', '"release\\nnext"'],
    ['release\tnext', '"release\\tnext"'],
    ['main\n', '"main\\n"'],
    ['rélease', '"rélease"'],
    ['main; version = 9', '"main; version = 9"'],
  ];
  const document = xcodeProject.read(source, file);
  for (const [value, expected] of cases) {
    const rule: Rule = { kind: 'branch', value };
    const result = document.update(new Map([[url, rule]]));
    assert.equal(result, source.replace(original, `\t\t\t\tkind = branch;\n\t\t\t\tbranch = ${expected};`));
    assert.deepEqual(xcodeProject.read(result, file).dependencies[0].rule, rule);
  }
});

test('pbxproj preserves existing quotes when the requirement has not changed', () => {
  const quoted = source.replace('version = 1.0.0;', 'version = "1.0.0";');
  const document = xcodeProject.read(quoted, file);
  assert.equal(document.update(new Map([[url, { kind: 'exact', value: '1.0.0' }]])), quoted);
  assert.equal(document.update(new Map()), quoted);
});
