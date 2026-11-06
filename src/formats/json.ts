import { fail } from './syntax';

export type JSONNode = {
  start: number;
  end: number;
  value?: string | number | boolean | null;
  fields?: Map<string, JSONNode>;
  items?: JSONNode[];
};

/** JSON with comments and trailing commas, retaining ranges for focused edits. */
export function readJSON(source: string, file: string): JSONNode {
  let cursor = 0;
  function whitespace(): void {
    for (;;) {
      while (/[ \t\r\n]/.test(source[cursor] ?? '') && cursor < source.length) cursor++;
      if (source.startsWith('//', cursor)) {
        const end = source.indexOf('\n', cursor + 2);
        cursor = end < 0 ? source.length : end;
      } else if (source.startsWith('/*', cursor)) {
        const end = source.indexOf('*/', cursor + 2);
        if (end < 0) fail(file, source, cursor, 'unterminated JSON comment');
        cursor = end + 2;
      } else return;
    }
  }

  function string(): string {
    const start = cursor++;
    while (cursor < source.length) {
      const character = source[cursor++];
      if (character === '\\') cursor++;
      else if (character === '"') {
        try { return JSON.parse(source.slice(start, cursor)) as string; }
        catch { fail(file, source, start, 'invalid JSON string'); }
      }
    }
    fail(file, source, start, 'unterminated JSON string');
  }

  function value(): JSONNode {
    whitespace();
    const start = cursor;
    const character = source[cursor];
    if (character === '"') return { start, value: string(), end: cursor };
    if (character === '{' || character === '[') {
      const object = character === '{';
      const close = object ? '}' : ']';
      const fields = new Map<string, JSONNode>();
      const items: JSONNode[] = [];
      cursor++;
      whitespace();
      while (source[cursor] !== close) {
        if (object) {
          if (source[cursor] !== '"') fail(file, source, cursor, 'expected JSON field name');
          const keyStart = cursor;
          const key = string();
          if (fields.has(key)) fail(file, source, keyStart, `duplicate JSON field ${key}`);
          whitespace();
          if (source[cursor++] !== ':') fail(file, source, cursor - 1, 'expected JSON colon');
          fields.set(key, value());
        } else items.push(value());
        whitespace();
        if (source[cursor] === close) break;
        if (source[cursor++] !== ',') fail(file, source, cursor - 1, 'expected JSON comma');
        whitespace();
      }
      cursor++;
      return { start, end: cursor, ...(object ? { fields } : { items }) };
    }
    const literal = source.slice(cursor).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
    if (!literal) fail(file, source, start, 'expected JSON value');
    cursor += literal.length;
    return { start, end: cursor, value: JSON.parse(literal) as number | boolean | null };
  }

  const result = value();
  whitespace();
  if (cursor !== source.length) fail(file, source, cursor, 'unexpected text after JSON value');
  return result;
}
