"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.openRepository = openRepository;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
function openRepository(root) {
    function readComparison(config) {
        if (git(root, 'rev-parse', 'HEAD').trim() !== config.pullRequest.head.sha) {
            throw new Error('checkout must be at the PR head SHA');
        }
        for (const file of [config.resolvedPath, ...config.watchedPaths])
            safePath(root, file);
        if (!node_fs_1.default.statSync(safePath(root, config.resolvedPath), { throwIfNoEntry: false })?.isFile()) {
            throw new Error(`${config.resolvedPath}: Package.resolved is missing or not a file`);
        }
        if (git(root, 'status', '--porcelain', '--', ...config.watchedPaths)) {
            throw new Error('watched files must be clean before syncing');
        }
        if (git(root, 'rev-parse', '--is-shallow-repository').trim() === 'true') {
            try {
                git(root, 'fetch', '--no-tags', '--unshallow', 'origin', config.pullRequest.base.sha);
            }
            catch (error) {
                throw new Error('could not fetch the Git history needed for comparison', { cause: error });
            }
        }
        const baseSHA = git(root, 'merge-base', 'HEAD', config.pullRequest.base.sha).trim();
        const base = {};
        const head = {};
        for (const file of config.watchedPaths) {
            const absolute = safePath(root, file);
            if (node_fs_1.default.existsSync(absolute))
                head[file] = node_fs_1.default.readFileSync(absolute, 'utf8');
            if (git(root, 'ls-tree', '-r', '-z', '--name-only', baseSHA, '--', file) === `${file}\0`) {
                base[file] = git(root, 'show', `${baseSHA}:${file}`);
            }
        }
        return { base, head };
    }
    function commitAndPush(updates, config) {
        const changed = Object.keys(updates);
        if (!changed.length)
            return undefined;
        for (const [file, content] of Object.entries(updates)) {
            const absolute = safePath(root, file);
            node_fs_1.default.mkdirSync(node_path_1.default.dirname(absolute), { recursive: true });
            node_fs_1.default.writeFileSync(absolute, content);
        }
        git(root, 'add', '--', ...changed);
        const body = [
            '[dependabot skip]',
            '',
            'Generated-by: felixherrmann/xcode-global-manifest',
            `Global-manifest: ${config.globalPath}`,
            `Source-commit: ${config.pullRequest.head.sha}`,
        ].join('\n');
        git(root, '-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com', 'commit', '-m', 'Sync global Swift manifest', '-m', body);
        git(root, 'push', 'origin', `HEAD:refs/heads/${config.pullRequest.head.ref}`);
        return git(root, 'rev-parse', 'HEAD').trim();
    }
    return { readComparison, commitAndPush };
}
function git(root, ...args) {
    return (0, node_child_process_1.execFileSync)('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
function safePath(root, relative) {
    if (!relative || node_path_1.default.isAbsolute(relative) || relative.startsWith('-') || relative.includes('\\') ||
        relative.split('/').some(part => !part || part === '.' || part === '..')) {
        throw new Error(`unsafe path: ${relative}`);
    }
    let current = root;
    for (const part of relative.split('/')) {
        current = node_path_1.default.join(current, part);
        if (node_fs_1.default.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
            throw new Error(`symlink path is not allowed: ${relative}`);
        }
    }
    return current;
}
