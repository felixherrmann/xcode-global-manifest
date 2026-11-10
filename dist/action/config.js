"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readConfig = readConfig;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const swift_1 = require("../formats/swift");
const xcode_project_1 = require("../formats/xcode-project");
function readConfig() {
    const event = JSON.parse(node_fs_1.default.readFileSync(required('GITHUB_EVENT_PATH'), 'utf8'));
    const pullRequest = event.pull_request;
    if (!pullRequest || pullRequest.head.repo.full_name !== pullRequest.base.repo.full_name ||
        pullRequest.base.repo.full_name !== process.env.GITHUB_REPOSITORY) {
        throw new Error('the action requires a same-repository pull_request_target event');
    }
    const resolvedPath = process.env['INPUT_RESOLVED-FILE'];
    const sourcePaths = inputPaths(process.env.INPUT_SOURCES || '');
    if (!resolvedPath || !sourcePaths.length)
        throw new Error('resolved-file and at least one source are required');
    const globalPath = node_path_1.default.posix.join(node_path_1.default.posix.dirname(resolvedPath), 'Package.swift');
    if (sourcePaths.includes(globalPath)) {
        throw new Error('the generated manifest cannot be a source');
    }
    const swiftToolsVersion = process.env['INPUT_SWIFT-TOOLS-VERSION']?.trim() || swift_1.DEFAULT_SWIFT_TOOLS_VERSION;
    if (!/^\d+\.\d+(?:\.\d+)?$/.test(swiftToolsVersion)) {
        throw new Error('swift-tools-version must be a version in major.minor or major.minor.patch form, such as 6.0 or 6.0.1');
    }
    return {
        root: required('GITHUB_WORKSPACE'),
        pullRequest,
        resolvedPath,
        globalPath,
        swiftToolsVersion,
        sources: sourcePaths.map(sourceFile),
        watchedPaths: [...sourcePaths, globalPath],
        outputPath: required('GITHUB_OUTPUT'),
    };
}
function sourceFile(file) {
    if (node_path_1.default.posix.basename(file) === 'Package.swift')
        return { file, format: swift_1.swiftManifest };
    if (file.endsWith('.pbxproj') || file.endsWith('.xcproj'))
        return { file, format: xcode_project_1.xcodeProject };
    throw new Error(`${file}: unsupported source format; expected Package.swift, .pbxproj, or .xcproj`);
}
function inputPaths(input) {
    return [...new Set(input.split('\n').map(value => value.trim()).filter(Boolean))];
}
function required(name) {
    const value = process.env[name];
    if (!value)
        throw new Error(`${name} is required`);
    return value;
}
