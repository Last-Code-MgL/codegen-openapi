/**
 * Helpers to edit openapi-gen.config.mjs as text, so user comments and formatting survive
 * `openapi-gen add` (the file is never re-serialized).
 */

/** Renders a JS value as source: single-quoted strings, nested objects, arrays. */
function renderValue(value: unknown, indent: string): string {
  if (typeof value === 'string') {
    return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n')}'`;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
  if (Array.isArray(value)) return `[${value.map((v) => renderValue(v, indent)).join(', ')}]`;
  if (typeof value === 'object') {
    const inner = indent + '  ';
    const pairs = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`, v] as const);
    if (!pairs.length) return '{}';

    // Small objects of plain values stay on one line: { env: 'API_URL', fallback: '...' }
    const flat = pairs.every(([, v]) => v === null || typeof v !== 'object');
    const inline = `{ ${pairs.map(([k, v]) => `${k}: ${renderValue(v, inner)}`).join(', ')} }`;
    if (flat && inline.length <= 72) return inline;

    return `{\n${pairs.map(([k, v]) => `${inner}${k}: ${renderValue(v, inner)},`).join('\n')}\n${indent}}`;
  }
  return 'undefined';
}

/** Renders one config entry as source, indented to sit inside the exported array. */
export function renderConfigEntry(entry: Record<string, unknown>) {
  return '  ' + renderValue(entry, '  ');
}

/**
 * Scans JS source starting at `from`, skipping strings, template literals and comments.
 * Calls `visit(char, index)` for every code character; stops when it returns true.
 */
function scanCode(src: string, from: number, visit: (ch: string, i: number) => boolean | void) {
  let i = from;
  const templateDepth: number[] = []; // brace depth at which each open template literal resumes
  let braceDepth = 0;

  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === '/' && next === '/') { i = src.indexOf('\n', i); if (i === -1) return; continue; }
    if (ch === '/' && next === '*') { i = src.indexOf('*/', i + 2); if (i === -1) return; i += 2; continue; }

    if (ch === '"' || ch === "'") {
      i++;
      while (i < src.length && src[i] !== ch) i += src[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }

    if (ch === '`' || (ch === '}' && templateDepth.length && templateDepth[templateDepth.length - 1] === braceDepth)) {
      if (ch === '}') templateDepth.pop();
      i++;
      // Inside a template literal: skip to its end or to the next ${
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') { templateDepth.push(braceDepth); i += 2; break; }
        i++;
      }
      if (src[i] === '`') i++;
      continue;
    }

    if (ch === '{') braceDepth++;
    if (ch === '}') braceDepth--;
    if (visit(ch, i)) return;
    i++;
  }
}

/** Index of the bracket that closes the one at `open`, ignoring strings and comments. */
function findClosing(src: string, open: number): number {
  const pairs: Record<string, string> = { '[': ']', '{': '}', '(': ')' };
  const stack: string[] = [];
  let result = -1;
  scanCode(src, open, (ch, i) => {
    if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) { result = i; return true; }
    }
  });
  return result;
}

/**
 * When the rest of the line after `from` is only whitespace and/or a comment
 * (e.g. `}, // main backend`), returns the end of that line so the comment stays attached.
 */
function endOfTrailingComment(src: string, from: number): number {
  const nl = src.indexOf('\n', from);
  const end = nl === -1 ? src.length : nl;
  return /^\s*(\/\/.*|\/\*.*\*\/\s*)?$/.test(src.slice(from, end).replace(/\r$/, '')) ? end : from;
}

/** Source up to `insertAt`, with a comma added right after the last code character when needed. */
function withComma(src: string, last: number, insertAt: number, needsComma: boolean) {
  if (!needsComma) return src.slice(0, insertAt);
  return src.slice(0, last + 1) + ',' + src.slice(last + 1, insertAt);
}

/** Index of the last code character before `end` (skipping whitespace and comments). */
function lastCodeCharBefore(src: string, start: number, end: number): number {
  let last = -1;
  scanCode(src.slice(0, end), start, (ch, i) => { if (!/\s/.test(ch)) last = i; });
  return last;
}

/**
 * Adds `name: { ... }` to the `apis` object of a config file (current format), preserving
 * everything else. Returns null when no `apis: { ... }` object is found.
 */
export function appendApiToConfig(source: string, name: string, api: Record<string, unknown>): string | null {
  let open = -1;
  scanCode(source, 0, (_, i) => {
    const before = source[i - 1];
    if (source.startsWith('apis', i) && !(before && /[\w$.]/.test(before))) {
      const m = /^apis\s*:\s*\{/.exec(source.slice(i));
      if (m) { open = i + m[0].length - 1; return true; }
    }
  });
  if (open === -1) return null;
  const close = findClosing(source, open);
  if (close === -1) return null;

  // Match the indentation of the `apis:` line
  const lineStart = source.lastIndexOf('\n', open) + 1;
  const indent = (/^[ \t]*/.exec(source.slice(lineStart))?.[0] ?? '') + '  ';
  const key = /^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`;
  const rendered = `${indent}${key}: ${renderValue(api, indent)}`;

  const last = lastCodeCharBefore(source, open + 1, close);
  const isEmpty = last === -1;
  const needsComma = !isEmpty && source[last] !== ',';
  const insertAt = isEmpty ? open + 1 : endOfTrailingComment(source, last + 1);
  const closingIndent = indent.slice(2);
  const rest = source.slice(insertAt).replace(/^[ \t]*\n?/, '');
  return `${withComma(source, last, insertAt, needsComma)}\n${rendered},\n${isEmpty ? closingIndent : ''}${rest}`;
}

/**
 * Appends a config entry to the array exported by a config file, preserving everything else.
 * Handles `export default [ ... ]` and `export default { ... }` (wrapped into an array).
 * Returns null when the file has another shape (e.g. `export default configs`), so the caller
 * can ask the user to paste the entry instead of rewriting their file.
 */
export function appendConfigEntry(source: string, entry: Record<string, unknown>): string | null {
  let exportIdx = -1;
  scanCode(source, 0, (_, i) => {
    if (source.startsWith('export default', i)) { exportIdx = i; return true; }
  });
  if (exportIdx === -1) return null;

  const valueStart = source.slice(exportIdx + 'export default'.length).search(/\S/);
  if (valueStart === -1) return null;
  const open = exportIdx + 'export default'.length + valueStart;
  const close = findClosing(source, open);
  if (close === -1) return null;

  const rendered = renderConfigEntry(entry);

  if (source[open] === '[') {
    const last = lastCodeCharBefore(source, open + 1, close);
    const isEmpty = last === -1;
    const needsComma = !isEmpty && source[last] !== ',';
    const insertAt = isEmpty ? open + 1 : endOfTrailingComment(source, last + 1);
    return `${withComma(source, last, insertAt, needsComma)}\n${isEmpty ? '' : '\n'}${rendered},\n${
      source.slice(insertAt).replace(/^[ \t]*\n?/, '')}`;
  }

  if (source[open] === '{') {
    const existing = source.slice(open, close + 1);
    return `${source.slice(0, open)}[\n  ${existing},\n\n${rendered},\n]${source.slice(close + 1)}`;
  }

  return null;
}
