/**
 * CodeParser — the PORT for AST-accurate TS/JS extraction (onion ring 2).
 *
 * `adapters/astgrep/index.ts` is the only file allowed to import
 * `@ast-grep/napi`; everything else codes against this interface and resolves
 * it from `container.codeParser`. `.dependency-cruiser.cjs` enforces that with
 * the `astgrep-only-through-its-port` rule.
 *
 * Why the types live HERE and not in index.ts: the implementation has to
 * import `CodeParser` to declare `implements`, so if the row types stayed in
 * index.ts the port would import the implementation and the implementation the
 * port — a cycle, which `no-circular` forbids. The dependency runs one way:
 * index.ts -> port.ts, and index.ts re-exports these names so existing
 * consumers (and test/astgrep.test.ts) keep their imports.
 *
 * `supports()` rather than `langForFile()`: every call site only ever asked
 * "can you parse this file?" (a truthiness check on the returned Lang), and
 * putting `Lang` in the port would leak an `@ast-grep/napi` type to every
 * consumer — defeating the point of having a port. The richer `langForFile`
 * stays exported from the adapter for its own tests.
 */
import type { ExtractedReference, ExtractedSymbol } from '../codeindex/extract.js';

/** A declaration. Superset of the regex extractor's row shape. */
export interface ParsedSymbol extends ExtractedSymbol {
  /** True when the declaration is reached through an `export` form. */
  exported: boolean;
  /** Declaration head trimmed to MAX_SIGNATURE_CHARS; null for kinds without one. */
  signature: string | null;
  /** 1-based line of the closing token of the declaration body. */
  endLine: number;
}

/** A call/usage site. */
export interface ParsedReference extends ExtractedReference {
  /** Path passed in by the caller — surfaced so consumers can fan-out. */
  refFile: string;
}

/** One import binding (`import { a as b } from 'x'` -> name 'b', source 'x'). */
export interface ParsedImport {
  name: string;
  source: string;
  isType: boolean;
}

/** A bare-identifier invocation head — the phantom-gate's input. */
export interface ParsedInvocationHead {
  /** The bare identifier being invoked (callee name, ctor name, or JSX tag). */
  name: string;
  /** 1-based line of the invocation. */
  line: number;
  /** Which AST shape produced this head. */
  kind: 'call' | 'new' | 'jsx';
}

/**
 * In-memory source extraction. Implementations are synchronous and MUST NOT
 * touch the filesystem, the network or the DB — callers read the source and
 * decide the scope (diff-scoped on the hot path, whole-walk when indexing).
 *
 * Implementations should be lenient: a syntactically broken file yields fewer
 * rows, it does not throw. Callers still wrap these in try/catch because a
 * native (napi) failure is possible.
 */
export interface CodeParser {
  /** True when this parser can handle the file (by extension). */
  supports(file: string): boolean;
  /** Declarations in `source`. Methods are emitted twice: `Class.m` and `m`. */
  parseSymbols(file: string, source: string): ParsedSymbol[];
  /** Call/usage sites in `source`, excluding the declaration lines themselves. */
  parseReferences(file: string, source: string): ParsedReference[];
  /** Bare-identifier invocation heads (member calls are deliberately skipped). */
  parseInvocationHeads(file: string, source: string): ParsedInvocationHead[];
  /** Import bindings, so consumers can tell "imported" from "undeclared". */
  parseImports(file: string, source: string): ParsedImport[];
}
