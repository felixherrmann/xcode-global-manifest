import type { Rule } from '../model';
import { textDocument, type DependencyFormat, type Occurrence } from './document';
import { readJSON, type JSONNode } from './json';
import { fail, lineAt } from './syntax';

// Schema: https://github.com/apple/xcode-project-format/tree/main/Sources/Library/Schema/Packages
export const xcproj: DependencyFormat = {
  read(source, file) {
    const root = readJSON(source, file);
    if (!root.fields) fail(file, source, root.start, 'expected an Xcode project object');
    const packages = root.fields.get('packages');
    if (packages && !packages.items) fail(file, source, packages.start, 'expected a packages array');

    const occurrences: Occurrence[] = [];
    for (const item of packages?.items ?? []) {
      if (!item.fields) fail(file, source, item.start, 'expected a package object');
      const kind = string(item.fields.get('kind'), item.start);
      if (kind === 'local') continue;
      if (kind !== 'remote') fail(file, source, item.start, `unsupported Xcode package kind ${kind}`);
      const url = string(item.fields.get('repository'), item.start);
      const version = item.fields.get('version');
      if (!version?.fields) fail(file, source, version?.start ?? item.start, 'expected a package version constraint');
      occurrences.push({
        url, rule: parseRule(version), start: version.start, end: version.end,
        file, line: lineAt(source, item.start),
      });
    }
    return textDocument(source, file, occurrences, (rule, occurrence) =>
      JSON.stringify(versionConstraint(rule, source, occurrence.start, file)));

    function string(node: JSONNode | undefined, offset: number): string {
      if (typeof node?.value !== 'string' || !node.value) fail(file, source, node?.start ?? offset, 'expected a nonempty package string');
      return node.value;
    }

    function parseRule(node: JSONNode): Rule {
      const fields = node.fields!;
      const keys = [...fields.keys()];
      const get = (key: string) => string(fields.get(key), node.start);
      if (keys.length === 2 && fields.has('version-range-min') && fields.has('version-range-max')) {
        return { kind: 'range', min: get('version-range-min'), max: get('version-range-max') };
      }
      if (keys.length !== 1) fail(file, source, node.start, 'expected one Xcode version constraint');
      const key = keys[0];
      const value = get(key);
      switch (key) {
        case 'version': return { kind: 'exact', value };
        case 'up-to-next-major-version': return { kind: 'major', value };
        case 'up-to-next-minor-version': return { kind: 'minor', value };
        case 'branch': case 'revision': return { kind: key, value };
        case 'version-range': {
          const bounds = value.split('..<');
          if (bounds.length !== 2 || bounds.some(bound => !bound)) fail(file, source, node.start, 'invalid Xcode version range');
          return { kind: 'range', min: bounds[0], max: bounds[1] };
        }
        default: fail(file, source, node.start, `unsupported Xcode version constraint ${key}`);
      }
    }
  },
};

function versionConstraint(rule: Rule, source: string, start: number, file: string): Record<string, string> {
  switch (rule.kind) {
    case 'closed': fail(file, source, start, 'inclusive Swift range cannot be represented in an Xcode project');
    case 'exact': return { version: rule.value };
    case 'major': return { 'up-to-next-major-version': rule.value };
    case 'minor': return { 'up-to-next-minor-version': rule.value };
    case 'branch': case 'revision': return { [rule.kind]: rule.value };
    case 'range': return /^[\d.]+$/.test(rule.min) && /^[\d.]+$/.test(rule.max)
      ? { 'version-range': `${rule.min}..<${rule.max}` }
      : { 'version-range-min': rule.min, 'version-range-max': rule.max };
  }
}
