/* Source-text assertions for spec 0020 that no runtime test can make:
 * - every file under `client/src/app/agents/` imports `@devdigest/shared`
 *   only as `import type` (a VALUE import passes typecheck and vitest and
 *   still breaks `next build` — client/INSIGHTS.md:83-89);
 * - the compare-modal folder never reaches for `dangerouslySetInnerHTML` or
 *   a markdown renderer (AC-57);
 * - no component under the case-detail dialog folder reads `actual_output`
 *   (AC-81);
 * - `client/messages/en/` gained no new file (AC-65 / C17).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const CLIENT_ROOT = join(__dirname, "../../");

function walk(dir: string, exts: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full, exts));
    } else if (exts.some((ext) => name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

describe("evals-static — source-text assertions (spec 0020)", () => {
  it("every file under client/src/app/agents/ imports @devdigest/shared only as `import type`", () => {
    const agentsDir = join(CLIENT_ROOT, "src/app/agents");
    const files = walk(agentsDir, [".ts", ".tsx"]);
    // Matches a whole `import … from "@devdigest/shared"` statement, named or
    // namespace, across however many lines it spans — a line-by-line scan
    // misses this codebase's usual multi-line `import type {\n …\n} from …`
    // shape, because the `from "@devdigest/shared"` line alone never
    // contains the word "import". The brace body excludes `{`, `}` and `;`
    // so the match can never backtrack across an unrelated import statement
    // to find a LATER "@devdigest/shared" elsewhere in the file.
    const importRe = /import\s+(type\s+)?(\{[^{};]*\}|\*\s+as\s+\w+|\w+)\s+from\s+["']@devdigest\/shared["']/g;
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(importRe)) {
        if (!match[1]) offenders.push(`${file}: ${match[0].slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no file under app/agents/ imports from app/skills/ (AC-68 — the compare modal reuses @/lib/text-diff, not a cross-feature import)", () => {
    const agentsDir = join(CLIENT_ROOT, "src/app/agents");
    const files = walk(agentsDir, [".ts", ".tsx"]);
    const offenders = files.filter((f) => readFileSync(f, "utf8").includes("app/skills"));
    expect(offenders).toEqual([]);
  });

  it("the compare-modal folder references no dangerouslySetInnerHTML and no markdown renderer", () => {
    const dir = join(
      CLIENT_ROOT,
      "src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/_components/CompareModal",
    );
    const files = walk(dir, [".ts", ".tsx"]).filter((f) => !f.endsWith(".test.tsx"));
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toContain("dangerouslySetInnerHTML");
      expect(text).not.toMatch(/\bMarkdown\b/);
      expect(text.toLowerCase()).not.toContain("react-markdown");
    }
  });

  it("no component under the case-detail dialog folder reads actual_output", () => {
    const dir = join(
      CLIENT_ROOT,
      "src/app/agents/[id]/_components/AgentEditor/_components/EvalsTab/_components/CaseDetailDialog",
    );
    const files = walk(dir, [".ts", ".tsx"]).filter((f) => !f.endsWith(".test.tsx"));
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toContain("actual_output");
    }
  });

  it("client/messages/en/ gained no new file", () => {
    const dir = join(CLIENT_ROOT, "messages/en");
    const files = readdirSync(dir).sort();
    expect(files).toEqual(
      [
        "agents.json",
        "brief.json",
        "common.json",
        "conventions.json",
        "errors.json",
        "evals.json",
        "home.json",
        "onboarding.json",
        "prReview.json",
        "runs.json",
        "settings.json",
        "shell.json",
        "skills.json",
      ].sort(),
    );
  });
});
