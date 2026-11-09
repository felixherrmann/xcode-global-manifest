import fs from 'node:fs';
import path from 'node:path';
import { swiftManifest } from '../formats/swift';
import { xcodeProject } from '../formats/xcode-project';
import type { SourceFile } from '../snapshot';

type PullRequest = {
  base: { sha: string; repo: { full_name: string } };
  head: { sha: string; ref: string; repo: { full_name: string } };
};

export type ActionConfig = {
  root: string;
  pullRequest: PullRequest;
  resolvedPath: string;
  globalPath: string;
  sources: SourceFile[];
  watchedPaths: string[];
  outputPath: string;
};

export function readConfig(): ActionConfig {
  const event = JSON.parse(fs.readFileSync(required('GITHUB_EVENT_PATH'), 'utf8')) as { pull_request?: PullRequest };
  const pullRequest = event.pull_request;
  if (!pullRequest || pullRequest.head.repo.full_name !== pullRequest.base.repo.full_name ||
      pullRequest.base.repo.full_name !== process.env.GITHUB_REPOSITORY) {
    throw new Error('the action requires a same-repository pull_request_target event');
  }

  const resolvedPath = process.env['INPUT_RESOLVED-FILE'];
  const sourcePaths = inputPaths(process.env.INPUT_SOURCES || '');
  if (!resolvedPath || !sourcePaths.length) throw new Error('resolved-file and at least one source are required');
  const globalPath = path.posix.join(path.posix.dirname(resolvedPath), 'Package.swift');
  if (sourcePaths.includes(globalPath)) {
    throw new Error('the generated manifest cannot be a source');
  }

  return {
    root: required('GITHUB_WORKSPACE'),
    pullRequest,
    resolvedPath,
    globalPath,
    sources: sourcePaths.map(sourceFile),
    watchedPaths: [...sourcePaths, globalPath],
    outputPath: required('GITHUB_OUTPUT'),
  };
}

function sourceFile(file: string): SourceFile {
  if (path.posix.basename(file) === 'Package.swift') return { file, format: swiftManifest };
  if (file.endsWith('.pbxproj') || file.endsWith('.xcproj')) return { file, format: xcodeProject };
  throw new Error(`${file}: unsupported source format; expected Package.swift, .pbxproj, or .xcproj`);
}

function inputPaths(input: string): string[] {
  return [...new Set(input.split('\n').map(value => value.trim()).filter(Boolean))];
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
