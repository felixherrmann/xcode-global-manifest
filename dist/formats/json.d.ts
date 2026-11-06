export type JSONNode = {
    start: number;
    end: number;
    value?: string | number | boolean | null;
    fields?: Map<string, JSONNode>;
    items?: JSONNode[];
};
/** JSON with comments and trailing commas, retaining ranges for focused edits. */
export declare function readJSON(source: string, file: string): JSONNode;
