import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Files } from '../model';
import type { ActionConfig } from './config';

export type Repository = {
  readComparison(config: ActionConfig): { base: Files; head: Files };
  commitAndPush(updates: Files, config: ActionConfig): string | undefined;
};

export function openRepository(root: string): Repository {
  function readComparison(config: ActionConfig): { base: Files; head: Files } {
    if (git(root, 'rev-parse', 'HEAD').trim() !== config.pullRequest.head.sha) {
      throw new Error('checkout must be at the PR head SHA');
    }
    for (const file of [config.resolvedPath, ...config.watchedPaths]) safePath(root, file);
    if (!fs.statSync(safePath(root, config.resolvedPath), { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`${config.resolvedPath}: Package.resolved is missing or not a file`);
    }
    if (git(root, 'status', '--porcelain', '--', ...config.watchedPaths)) {
      throw new Error('watched files must be clean before syncing');
    }

    if (git(root, 'rev-parse', '--is-shallow-repository').trim() === 'true') {
      try {
        git(root, 'fetch', '--no-tags', '--unshallow', 'origin', config.pullRequest.base.sha);
      } catch (error) {
        throw new Error('could not fetch the Git history needed for comparison', { cause: error });
      }
    }
    const baseSHA = git(root, 'merge-base', 'HEAD', config.pullRequest.base.sha).trim();
    const base: Files = {};
    const head: Files = {};
    for (const file of config.watchedPaths) {
      const absolute = safePath(root, file);
      if (fs.existsSync(absolute)) head[file] = fs.readFileSync(absolute, 'utf8');
      if (git(root, 'ls-tree', '-r', '-z', '--name-only', baseSHA, '--', file) === `${file}\0`) {
        base[file] = git(root, 'show', `${baseSHA}:${file}`);
      }
    }
    return { base, head };
  }

  function commitAndPush(updates: Files, config: ActionConfig): string | undefined {
    const changed = Object.keys(updates);
    if (!changed.length) return undefined;

    for (const [file, content] of Object.entries(updates)) {
      const absolute = safePath(root, file);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, content);
    }
    git(root, 'add', '--', ...changed);
    const body = [
      '[dependabot skip]',
      '',
      'Generated-by: felixherrmann/xcode-global-manifest',
      `Global-manifest: ${config.globalPath}`,
      `Source-commit: ${config.pullRequest.head.sha}`,
    ].join('\n');
    git(root, '-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit', '-m', 'Sync global Swift manifest', '-m', body);
    git(root, 'push', 'origin', `HEAD:refs/heads/${config.pullRequest.head.ref}`);
    return git(root, 'rev-parse', 'HEAD').trim();
  }

  return { readComparison, commitAndPush };
}

function git(root: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function safePath(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.startsWith('-') || relative.includes('\\') ||
      relative.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`unsafe path: ${relative}`);
  }
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`symlink path is not allowed: ${relative}`);
    }
  }
  return current;
}
