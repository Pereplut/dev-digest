/**
 * PR detail page (`/repos/:repoId/pulls/:number`) — spec 0018 AC-42.
 *
 * Closes a gap `plan-verifier` found: the spec's test-plan row for AC-42
 * claims an assertion that the router navigation target equals
 * `?tab=diff&file=src%2Fapi%2Fusers.ts` (percent-encoded). No such assertion
 * existed — `PrBriefBlock.test.tsx` only proves its `onFocusFile` callback
 * receives the raw, unencoded path; the URL composition
 * (`handleFocusFile`/`setParams`, `page.tsx:66-85`) happens one level up, in
 * this page component, and was untested.
 *
 * This mounts the real default-exported page, so the click travels through
 * the actual `onFocusFile` → `handleFocusFile` → `setParams` →
 * `router.replace(...)` chain, including the real `URLSearchParams`
 * percent-encoding — nothing here re-implements that composition.
 *
 * `AppShell` and `PrDetailHeader` are stubbed: both are rendered
 * unconditionally by this page but their own data (shell nav/commands,
 * `RunReviewDropdown`'s agents/run hooks) has no bearing on AC-42, and
 * stubbing a sibling whose internals are out of scope — rather than wiring
 * up its whole hook chain — is the pattern `OverviewTab.test.tsx` already
 * uses for `PrIntentCard`. `FindingsTab`, `DiffTab` and `RunTraceDrawer` are
 * left real but unmocked: with `tab` defaulting to "overview" and no
 * `?trace=`, none of them renders, so none of their hooks ever run.
 * `OverviewTab` and `PrBriefBlock` are real; `PrIntentCard` and
 * `BlastRadiusCard` render `null` from their own real "no data" branch once
 * their data hooks are stubbed to report nothing — no separate component
 * mock needed for either.
 */
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrBriefEnvelope, PrBriefResponse, PrDetail } from "@/lib/types";
import prReviewMessages from "../../../../../../messages/en/prReview.json";
import briefMessages from "../../../../../../messages/en/brief.json";
import PRDetailPage from "./page";

const routerReplace = vi.hoisted(() => vi.fn());
const briefState = vi.hoisted(() => ({
  current: { brief: null, stale: false } as PrBriefResponse,
}));

const PR_FIXTURE = vi.hoisted(
  (): PrDetail => ({
    id: "pr-1",
    number: 7,
    title: "Add rate limiter",
    author: "octocat",
    branch: "feature/rate-limit",
    base: "main",
    head_sha: "abc123",
    additions: 10,
    deletions: 2,
    files_count: 1,
    status: "open",
    opened_at: null,
    updated_at: null,
    score: null,
    cost_usd: null,
    cost_complete: null,
    findings_counts: null,
    findings_run_id: null,
    body: null,
    files: [{ path: "src/api/users.ts", additions: 10, deletions: 2, patch: null }],
    commits: [],
    linked_issue: null,
  }),
);

// Only `repoId` and `number` (both read via `useParams`) and `router.replace`
// (the thing under test) matter here; `useSearchParams` stays a fixed empty
// set — the page composes each new URL from scratch via `setParams`, it
// never reads back what it last wrote.
vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo-1", number: "7" }),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: routerReplace, push: vi.fn() }),
}));

vi.mock("../../../../../components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./_components/PrDetailHeader", () => ({
  PrDetailHeader: () => null,
}));

vi.mock("@/lib/hooks", () => ({
  usePullByNumber: () => ({
    data: PR_FIXTURE,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: [], refetch: vi.fn() }),
  usePrActiveRuns: () => ({ data: [] }),
  usePrRuns: () => ({ data: [] }),
  useDeleteRun: () => ({ mutate: vi.fn() }),
  useCancelRun: () => ({ mutate: vi.fn() }),
  // PrIntentCard's hook — stubbed to "no data" so the real card renders
  // null via its own `if (!intent) return null` branch (PrIntentCard.tsx:28).
  usePrIntent: () => ({ data: null }),
}));

// BlastRadiusCard's hook — same "no data" treatment as usePrIntent above.
vi.mock("@/lib/hooks/core", () => ({
  usePrBlast: () => ({ data: undefined, isLoading: false }),
}));

vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: () => ({ data: briefState.current }),
  useGenerateBrief: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../../../../../lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { id: "repo-1", full_name: "acme/payments-api" } }),
  useRepoNotFound: () => false,
}));

function brief(): PrBriefEnvelope {
  return {
    intent: { intent: "", in_scope: [], out_of_scope: [] },
    blast: { changed_symbols: [], downstream: [], summary: "" },
    risks: { risks: [] },
    history: { history: [] },
    summary: "Tightens the rate limiter.",
    review_focus: [{ file: "src/api/users.ts", line: 42, reason: "The off-by-one lives here." }],
    head_sha: "abc123",
    generated_at: "2026-01-01T00:00:00Z",
    model: "test-model",
    missing_inputs: [],
  };
}

afterEach(cleanup);
beforeEach(() => {
  briefState.current = { brief: brief(), stale: false };
  routerReplace.mockClear();
});

describe("PR detail page — review-focus deep link (AC-42)", () => {
  it("activating a review-focus row sets tab=diff and a percent-encoded file query, via router.replace (no full page load)", async () => {
    const user = userEvent.setup();
    const qc = new QueryClient();

    render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, brief: briefMessages }}>
          <PRDetailPage />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: /src\/api\/users\.ts/ }));

    expect(routerReplace).toHaveBeenCalledTimes(1);
    expect(routerReplace).toHaveBeenCalledWith("/repos/repo-1/pulls/7?tab=diff&file=src%2Fapi%2Fusers.ts");
  });
});
