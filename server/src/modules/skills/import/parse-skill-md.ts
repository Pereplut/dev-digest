/**
 * Parse a skill markdown file: an optional `---` frontmatter block followed by
 * the body. Pure (no I/O) so it unit-tests without a DB.
 *
 * The server has no YAML dependency, and a skill's frontmatter only ever needs
 * a handful of top-level scalars, so this is a deliberately MINIMAL reader:
 * - `key: plain value` (a trailing ` # comment` is dropped; indented
 *   continuation lines are folded into the value);
 * - `key: "double quoted"` (with `\"`, `\\`, `\n`, `\t` escapes) and
 *   `key: 'single quoted'` (`''` → `'`);
 * - block scalars `key: >`, `>-`, `>+`, `|`, `|-`, `|+` (an indentation digit
 *   is accepted and ignored — the first content line sets the indent).
 * Nested mappings and lists are skipped, never evaluated. Nothing here can
 * execute anything: values are only ever strings.
 */

export interface ParsedSkillMarkdown {
  /** Top-level scalar keys found in the frontmatter (lower-cased). */
  frontmatter: Record<string, string>;
  /** Markdown after the frontmatter, trimmed. */
  body: string;
  /** Whether a closed `---` frontmatter block was present. */
  hasFrontmatter: boolean;
}

const KEY_RE = /^([A-Za-z_][\w-]*)\s*:(.*)$/;
const BLOCK_RE = /^([|>])([+-]?)\d?([+-]?)\s*(#.*)?$/;

export function parseSkillMarkdown(input: string): ParsedSkillMarkdown {
  const text = input.replace(/^\u{FEFF}/u, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');

  if (lines[0]?.trim() !== '---') {
    return { frontmatter: {}, body: text.trim(), hasFrontmatter: false };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]!.trimEnd();
    if (l === '---' || l === '...') {
      end = i;
      break;
    }
  }
  // An unclosed block is not frontmatter — treat the whole file as body.
  if (end === -1) return { frontmatter: {}, body: text.trim(), hasFrontmatter: false };

  return {
    frontmatter: parseFrontmatterLines(lines.slice(1, end)),
    body: lines.slice(end + 1).join('\n').trim(),
    hasFrontmatter: true,
  };
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function parseFrontmatterLines(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    // Only top-level keys; indented lines belong to something we skip.
    if (line.trim() === '' || line.trimStart().startsWith('#') || indentOf(line) > 0) {
      i++;
      continue;
    }
    const m = KEY_RE.exec(line);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1]!.toLowerCase();
    const rest = m[2]!.trim();

    // Continuation lines: everything after this key that is blank or indented.
    let j = i + 1;
    while (j < lines.length && (lines[j]!.trim() === '' || indentOf(lines[j]!) > 0)) j++;
    const cont = lines.slice(i + 1, j);
    i = j;

    const block = BLOCK_RE.exec(rest);
    if (block) {
      const style = block[1]!;
      const chomp = block[2] || block[3] || '';
      out[key] = blockScalar(cont, style === '>', chomp);
      continue;
    }
    if (rest === '') continue; // nested mapping / list — not a scalar, skipped
    if (rest.startsWith('"')) {
      const v = doubleQuoted(rest, cont);
      if (v !== undefined) out[key] = v;
      continue;
    }
    if (rest.startsWith("'")) {
      const v = singleQuoted(rest, cont);
      if (v !== undefined) out[key] = v;
      continue;
    }
    if (rest.startsWith('[') || rest.startsWith('{')) continue; // flow collection — skipped
    out[key] = foldPlain([stripComment(rest), ...cont.map((c) => stripComment(c.trim()))]);
  }
  return out;
}

/** Drop a ` # comment` from a plain scalar (a `#` not preceded by space stays). */
function stripComment(s: string): string {
  const idx = s.search(/\s#/);
  return (idx === -1 ? s : s.slice(0, idx)).trim();
}

/** Plain multi-line scalars fold: line breaks → spaces, blank lines → newline. */
function foldPlain(parts: string[]): string {
  let out = '';
  let pendingBreak = false;
  for (const p of parts) {
    if (p === '') {
      pendingBreak = true;
      continue;
    }
    if (out === '') out = p;
    else out += (pendingBreak ? '\n' : ' ') + p;
    pendingBreak = false;
  }
  return out.trim();
}

function blockScalar(cont: string[], folded: boolean, chomp: string): string {
  // Trailing blank lines are part of chomping, not content.
  let last = cont.length - 1;
  while (last >= 0 && cont[last]!.trim() === '') last--;
  const lines = cont.slice(0, last + 1);
  const first = lines.find((l) => l.trim() !== '');
  if (first === undefined) return '';
  const indent = indentOf(first);
  const dedented = lines.map((l) => (l.trim() === '' ? '' : l.slice(Math.min(indent, indentOf(l)))));

  let value: string;
  if (!folded) {
    value = dedented.join('\n');
  } else {
    // Folding: consecutive non-empty lines join with a space; each blank line
    // is a newline; more-indented lines keep their breaks (YAML spec 8.1.3).
    value = '';
    let prevMoreIndented = false;
    let blanks = 0;
    for (const l of dedented) {
      if (l === '') {
        blanks++;
        continue;
      }
      const moreIndented = /^\s/.test(l);
      if (value === '') {
        value = '\n'.repeat(blanks) + l;
      } else if (blanks > 0) {
        value += '\n'.repeat(blanks) + l;
      } else {
        value += (moreIndented || prevMoreIndented ? '\n' : ' ') + l;
      }
      blanks = 0;
      prevMoreIndented = moreIndented;
    }
  }
  if (chomp === '-') return value;
  // Clip (default) and keep (`+`) both end with a newline; callers trim anyway.
  return `${value}\n`;
}

function doubleQuoted(rest: string, cont: string[]): string | undefined {
  const src = [rest, ...cont.map((c) => c.trim())].join(' ');
  let out = '';
  for (let k = 1; k < src.length; k++) {
    const ch = src[k]!;
    if (ch === '\\') {
      const nx = src[++k];
      if (nx === 'n') out += '\n';
      else if (nx === 't') out += '\t';
      else if (nx !== undefined) out += nx;
      continue;
    }
    if (ch === '"') return out;
    out += ch;
  }
  return undefined; // unterminated
}

function singleQuoted(rest: string, cont: string[]): string | undefined {
  const src = [rest, ...cont.map((c) => c.trim())].join(' ');
  let out = '';
  for (let k = 1; k < src.length; k++) {
    const ch = src[k]!;
    if (ch === "'") {
      if (src[k + 1] === "'") {
        out += "'";
        k++;
        continue;
      }
      return out;
    }
    out += ch;
  }
  return undefined;
}
