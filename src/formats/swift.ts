import type { Rule } from '../model';
import { textDocument, type DependencyFormat, type Occurrence } from './document';
import { closing, fail, lineAt, literal, pieces, quote, tokens, type Token } from './syntax';

export const DEFAULT_SWIFT_TOOLS_VERSION = '5.9';

export const swiftManifest: DependencyFormat = {
  read(source, file) {
    return textDocument(source, file, parseSwift(source, file), renderSwiftRule);
  },
};

function parseRule(arg: Token[], file: string, source: string): Rule {
  const first = arg[0];
  if (isNamedArgument(arg, ['exact', 'from', 'branch', 'revision'])) {
    const value = literal(arg.slice(2), file, source);
    switch (first.value) {
      case 'from': return { kind: 'major', value };
      case 'exact': return { kind: 'exact', value };
      case 'branch': return { kind: 'branch', value };
      case 'revision': return { kind: 'revision', value };
    }
  }
  if (first.value === '.' && arg[1]?.type === 'word' && arg[2]?.value === '(' && closing(arg, 2, file, source) === arg.length - 1) {
    const name = arg[1].value;
    const inner = arg.slice(3, -1);
    if (['upToNextMajor', 'upToNextMinor'].includes(name) && isNamedArgument(inner, ['from'])) {
      return { kind: name === 'upToNextMajor' ? 'major' : 'minor', value: literal(inner.slice(2), file, source) };
    }
    if (name === 'exact' || name === 'branch' || name === 'revision') {
      return { kind: name, value: literal(inner, file, source) };
    }
  }
  if (arg.length === 3 && arg[0].type === 'string' && arg[2].type === 'string' && ['..<', '...'].includes(arg[1].value)) {
    return { kind: arg[1].value === '..<' ? 'range' : 'closed', min: arg[0].value, max: arg[2].value };
  }
  fail(file, source, first.start, 'unsupported Swift package requirement');
}

function isNamedArgument(argument: Token[], names: string[]): boolean {
  return argument[1]?.value === ':' && names.includes(argument[0].value);
}

function isPackageCall(allTokens: Token[], index: number): boolean {
  return allTokens[index].value === '.'
    && allTokens[index + 1]?.value === 'package'
    && allTokens[index + 2]?.value === '(';
}

function dependencyEntries(allTokens: Token[], file: string, source: string): Token[][] {
  const packages: number[] = [];
  for (let index = 0; index < allTokens.length - 1; index++) {
    if (allTokens[index].value === 'Package' && allTokens[index + 1].value === '(') {
      packages.push(index);
    }
  }
  if (packages.length !== 1) {
    fail(file, source, 0, 'expected one literal Package(...) initializer');
  }

  const opening = packages[0] + 1;
  const end = closing(allTokens, opening, file, source);
  const argumentsList = pieces(allTokens, opening + 1, end, ',', file, source);
  const dependencies = argumentsList.filter(argument => isNamedArgument(argument, ['dependencies']));
  if (dependencies.length > 1) {
    fail(file, source, dependencies[1][0].start, 'duplicate dependencies argument');
  }

  const argument = dependencies[0];
  if (!argument) return [];
  if (argument[2]?.value !== '[' || closing(argument, 2, file, source) !== argument.length - 1) {
    fail(file, source, argument[2]?.start || argument[0].start, 'dependencies must be a literal array');
  }
  return pieces(argument, 3, argument.length - 1, ',', file, source);
}

function parseDependency(entry: Token[], file: string, source: string): Occurrence | undefined {
  if (!isPackageCall(entry, 0) || closing(entry, 2, file, source) !== entry.length - 1) {
    fail(file, source, entry[0].start, 'dependency must be a literal .package(...) declaration');
  }

  const argumentsList = pieces(entry, 3, entry.length - 1, ',', file, source);
  const identities = argumentsList.filter(argument => isNamedArgument(argument, ['url', 'path', 'id']));
  if (identities.length !== 1) {
    fail(file, source, entry[0].start, 'expected one package identity');
  }
  const identity = identities[0];
  if (identity[0].value !== 'url') return undefined;

  const url = literal(identity.slice(2), file, source);
  const requirements = argumentsList.filter(argument =>
    isNamedArgument(argument, ['exact', 'from', 'branch', 'revision'])
    || argument[0].value === '.'
    || argument[0].type === 'string');
  if (requirements.length !== 1) {
    fail(file, source, entry[0].start, 'expected one package requirement');
  }

  const requirement = requirements[0];
  return {
    url,
    rule: parseRule(requirement, file, source),
    start: requirement[0].start,
    end: requirement.at(-1)!.end,
    file,
    line: lineAt(source, entry[0].start),
  };
}

export function parseSwift(source: string, file: string): Occurrence[] {
  const allTokens = tokens(source, file);
  const entries = dependencyEntries(allTokens, file, source);
  const declarations: Occurrence[] = [];
  const consumed = new Set<number>();

  for (const entry of entries) {
    const declaration = parseDependency(entry, file, source);
    consumed.add(entry[0].start);
    if (declaration) declarations.push(declaration);
  }

  // Every .package call must belong to the literal array, including local packages.
  for (let index = 0; index < allTokens.length; index++) {
    const token = allTokens[index];
    if (isPackageCall(allTokens, index) && !consumed.has(token.start)) {
      fail(file, source, token.start, 'package declaration is outside the literal dependencies array');
    }
  }
  return declarations;
}

export function renderSwiftRule(rule: Rule): string {
  switch (rule.kind) {
    case 'exact': return `exact: ${quote(rule.value)}`;
    case 'major': return `from: ${quote(rule.value)}`;
    case 'minor': return `.upToNextMinor(from: ${quote(rule.value)})`;
    case 'range': return `${quote(rule.min)}..<${quote(rule.max)}`;
    case 'closed': return `${quote(rule.min)}...${quote(rule.max)}`;
    case 'branch': return `branch: ${quote(rule.value)}`;
    case 'revision': return `revision: ${quote(rule.value)}`;
  }
}

export function generate(byURL: ReadonlyMap<string, { rule: Rule }>, swiftToolsVersion = DEFAULT_SWIFT_TOOLS_VERSION): string {
  const deps = [...byURL].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([url, item]) => `        .package(url: ${quote(url)}, ${renderSwiftRule(item.rule)}),`);
  return `// swift-tools-version: ${swiftToolsVersion}\n// Generated by xcode-global-manifest. Edit source manifests to add or remove packages.\n\nimport PackageDescription\n\nlet package = Package(\n    name: "XcodeGlobalManifest",\n    dependencies: [\n${deps.join('\n')}${deps.length ? '\n' : ''}    ]\n)\n`;
}
