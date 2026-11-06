"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readJSON = readJSON;
const syntax_1 = require("./syntax");
/** JSON with comments and trailing commas, retaining ranges for focused edits. */
function readJSON(source, file) {
    let cursor = 0;
    function whitespace() {
        for (;;) {
            while (/[ \t\r\n]/.test(source[cursor] ?? '') && cursor < source.length)
                cursor++;
            if (source.startsWith('//', cursor)) {
                const end = source.indexOf('\n', cursor + 2);
                cursor = end < 0 ? source.length : end;
            }
            else if (source.startsWith('/*', cursor)) {
                const end = source.indexOf('*/', cursor + 2);
                if (end < 0)
                    (0, syntax_1.fail)(file, source, cursor, 'unterminated JSON comment');
                cursor = end + 2;
            }
            else
                return;
        }
    }
    function string() {
        const start = cursor++;
        while (cursor < source.length) {
            const character = source[cursor++];
            if (character === '\\')
                cursor++;
            else if (character === '"') {
                try {
                    return JSON.parse(source.slice(start, cursor));
                }
                catch {
                    (0, syntax_1.fail)(file, source, start, 'invalid JSON string');
                }
            }
        }
        (0, syntax_1.fail)(file, source, start, 'unterminated JSON string');
    }
    function value() {
        whitespace();
        const start = cursor;
        const character = source[cursor];
        if (character === '"')
            return { start, value: string(), end: cursor };
        if (character === '{' || character === '[') {
            const object = character === '{';
            const close = object ? '}' : ']';
            const fields = new Map();
            const items = [];
            cursor++;
            whitespace();
            while (source[cursor] !== close) {
                if (object) {
                    if (source[cursor] !== '"')
                        (0, syntax_1.fail)(file, source, cursor, 'expected JSON field name');
                    const keyStart = cursor;
                    const key = string();
                    if (fields.has(key))
                        (0, syntax_1.fail)(file, source, keyStart, `duplicate JSON field ${key}`);
                    whitespace();
                    if (source[cursor++] !== ':')
                        (0, syntax_1.fail)(file, source, cursor - 1, 'expected JSON colon');
                    fields.set(key, value());
                }
                else
                    items.push(value());
                whitespace();
                if (source[cursor] === close)
                    break;
                if (source[cursor++] !== ',')
                    (0, syntax_1.fail)(file, source, cursor - 1, 'expected JSON comma');
                whitespace();
            }
            cursor++;
            return { start, end: cursor, ...(object ? { fields } : { items }) };
        }
        const literal = source.slice(cursor).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
        if (!literal)
            (0, syntax_1.fail)(file, source, start, 'expected JSON value');
        cursor += literal.length;
        return { start, end: cursor, value: JSON.parse(literal) };
    }
    const result = value();
    whitespace();
    if (cursor !== source.length)
        (0, syntax_1.fail)(file, source, cursor, 'unexpected text after JSON value');
    return result;
}
