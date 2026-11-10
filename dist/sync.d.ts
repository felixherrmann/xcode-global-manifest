import type { Files } from './model';
import { type SourceFile } from './snapshot';
export type SyncInput = {
    base: Files;
    head: Files;
    sources: SourceFile[];
    globalPath: string;
    swiftToolsVersion?: string;
};
/** Read dependencies, reconcile both directions, then render only changed files. */
export declare function synchronize({ base, head, sources, globalPath, swiftToolsVersion }: SyncInput): Files;
