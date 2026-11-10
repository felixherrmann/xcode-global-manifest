import type { SourceFile } from '../snapshot';
type PullRequest = {
    base: {
        sha: string;
        repo: {
            full_name: string;
        };
    };
    head: {
        sha: string;
        ref: string;
        repo: {
            full_name: string;
        };
    };
};
export type ActionConfig = {
    root: string;
    pullRequest: PullRequest;
    resolvedPath: string;
    globalPath: string;
    swiftToolsVersion: string;
    sources: SourceFile[];
    watchedPaths: string[];
    outputPath: string;
};
export declare function readConfig(): ActionConfig;
export {};
