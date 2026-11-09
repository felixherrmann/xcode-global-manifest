"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pbxproj = void 0;
exports.parseProject = parseProject;
exports.renderProjectRule = renderProjectRule;
const document_1 = require("./document");
const syntax_1 = require("./syntax");
exports.pbxproj = {
    read(source, file) {
        return (0, document_1.textDocument)(source, file, parseProject(source, file), (rule, occurrence) => renderProjectRule(rule, source, occurrence.start, file));
    },
};
function fields(ts, start, end, file, source) {
    const result = new Map();
    for (const field of (0, syntax_1.pieces)(ts, start, end, ';', file, source)) {
        if (field[1]?.value !== '=' || field.length < 3)
            (0, syntax_1.fail)(file, source, field[0]?.start || 0, 'invalid project field');
        if (result.has(field[0].value))
            (0, syntax_1.fail)(file, source, field[0].start, `duplicate project field ${field[0].value}`);
        result.set(field[0].value, field.slice(2));
    }
    return result;
}
function scalar(ts, file, source) {
    if (!ts?.length)
        (0, syntax_1.fail)(file, source, 0, 'missing project value');
    if (ts.length === 1 && ts[0].type === 'string')
        return ts[0].value;
    if (ts.some(t => t.type === 'string'))
        (0, syntax_1.fail)(file, source, ts[0].start, 'invalid project scalar');
    return ts.map(t => t.value).join('');
}
function packageReferenceTokens(source, file) {
    const marker = '/* Begin XCRemoteSwiftPackageReference section */';
    const begin = source.indexOf(marker);
    const finish = source.indexOf('/* End XCRemoteSwiftPackageReference section */');
    if (begin < 0 && finish < 0 && !/\bisa\s*=\s*XCRemoteSwiftPackageReference\b/.test(source))
        return [];
    if (begin < 0 || finish < begin) {
        (0, syntax_1.fail)(file, source, 0, 'missing XCRemoteSwiftPackageReference section');
    }
    return (0, syntax_1.tokens)(source, file, begin + marker.length, finish);
}
function parseProjectRule(requirement, file, source) {
    const properties = fields(requirement, 1, requirement.length - 1, file, source);
    const value = (key) => scalar(properties.get(key), file, source);
    const kind = value('kind');
    switch (kind) {
        case 'exactVersion': return { kind: 'exact', value: value('version') };
        case 'upToNextMajorVersion': return { kind: 'major', value: value('minimumVersion') };
        case 'upToNextMinorVersion': return { kind: 'minor', value: value('minimumVersion') };
        case 'versionRange': return { kind: 'range', min: value('minimumVersion'), max: value('maximumVersion') };
        case 'branch':
        case 'revision': return { kind, value: value(kind) };
        default: (0, syntax_1.fail)(file, source, requirement[0].start, `unsupported Xcode requirement ${kind}`);
    }
}
function parsePackageReference(object, file, source) {
    // The object includes its identifier, equals sign, and braces, but not its semicolon.
    const properties = fields(object, 3, object.length - 1, file, source);
    if (scalar(properties.get('isa'), file, source) !== 'XCRemoteSwiftPackageReference') {
        (0, syntax_1.fail)(file, source, object[0].start, 'unexpected object in package reference section');
    }
    const url = scalar(properties.get('repositoryURL'), file, source);
    const requirement = properties.get('requirement');
    if (requirement?.[0]?.value !== '{' || (0, syntax_1.closing)(requirement, 0, file, source) !== requirement.length - 1) {
        (0, syntax_1.fail)(file, source, object[0].start, 'invalid package requirement');
    }
    return {
        url,
        rule: parseProjectRule(requirement, file, source),
        start: requirement[0].start,
        end: requirement.at(-1).end,
        file,
        line: (0, syntax_1.lineAt)(source, object[0].start),
    };
}
function parseProject(source, file) {
    const section = packageReferenceTokens(source, file);
    const declarations = [];
    for (let index = 0; index < section.length;) {
        if (section[index + 1]?.value !== '=' || section[index + 2]?.value !== '{') {
            (0, syntax_1.fail)(file, source, section[index].start, 'invalid package reference object');
        }
        const end = (0, syntax_1.closing)(section, index + 2, file, source);
        if (section[end + 1]?.value !== ';') {
            (0, syntax_1.fail)(file, source, section[end].start, 'unterminated package reference object');
        }
        declarations.push(parsePackageReference(section.slice(index, end + 1), file, source));
        index = end + 2;
    }
    return declarations;
}
function projectScalar(value) {
    // Match Xcode's bare scalars, excluding comment starts and special underscore sequences.
    const unquoted = value.length > 0 && !/[^A-Za-z0-9_./$]/.test(value)
        && !value.includes('//') && !value.includes('___');
    return unquoted ? value : (0, syntax_1.quote)(value);
}
function renderProjectRule(rule, source, start, file) {
    if (rule.kind === 'closed')
        (0, syntax_1.fail)(file, source, start, 'inclusive Swift range cannot be represented in an Xcode project');
    const indent = source.slice(source.lastIndexOf('\n', start - 1) + 1, start).match(/^\s*/)?.[0] || '';
    const inside = `${indent}\t`;
    let props;
    switch (rule.kind) {
        case 'exact':
            props = ['kind = exactVersion', `version = ${projectScalar(rule.value)}`];
            break;
        case 'major':
            props = ['kind = upToNextMajorVersion', `minimumVersion = ${projectScalar(rule.value)}`];
            break;
        case 'minor':
            props = ['kind = upToNextMinorVersion', `minimumVersion = ${projectScalar(rule.value)}`];
            break;
        case 'range':
            props = ['kind = versionRange', `minimumVersion = ${projectScalar(rule.min)}`, `maximumVersion = ${projectScalar(rule.max)}`];
            break;
        case 'branch':
        case 'revision':
            props = [`kind = ${rule.kind}`, `${rule.kind} = ${projectScalar(rule.value)}`];
            break;
    }
    return `{\n${props.map(p => `${inside}${p};`).join('\n')}\n${indent}}`;
}
