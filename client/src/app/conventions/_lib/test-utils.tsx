/* Test-only helpers for the Conventions page tests (not imported by app code). */
import React from "react";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ConventionCandidate, ConventionScan, ConventionSkillDefaults } from "@devdigest/shared";
import messages from "../../../../messages/en/conventions.json";
import { ToastProvider } from "../../../lib/toast";

export function makeCandidate(over: Partial<ConventionCandidate> = {}): ConventionCandidate {
  return {
    id: "c1",
    category: "async",
    rule: "Always use async/await instead of .then() chains",
    evidence_path: "src/api/users.ts",
    evidence_start_line: 23,
    evidence_end_line: 31,
    evidence_snippet: "const user = await db.users.find(id);",
    confidence: 0.91,
    status: "pending",
    evidence_valid: true,
    rejected_reason: null,
    updated_at: "2026-09-20T10:00:00.000Z",
    ...over,
  };
}

export function makeScan(over: Partial<ConventionScan> = {}): ConventionScan {
  return {
    id: "s1",
    status: "done",
    sampler: "repo-intel",
    sample_file_count: 84,
    candidate_count: 3,
    rejected_count: 0,
    model: "deepseek/deepseek-v4-flash",
    cost_usd: 0.0012,
    error: null,
    started_at: "2026-09-20T09:00:00.000Z",
    finished_at: "2026-09-20T09:00:20.000Z",
    ...over,
  };
}

export function makeSkillDefaults(
  over: Partial<ConventionSkillDefaults> = {},
): ConventionSkillDefaults {
  return {
    name: "payments-api-conventions",
    description: "1 house convention extracted from payments-api",
    type: "convention",
    body: "# payments-api-conventions\n\nHouse conventions for `payments-api`.",
    accepted_count: 1,
    ...over,
  };
}

/** Renders with the `conventions` i18n namespace, a fresh QueryClient and toasts. */
export function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
        <ToastProvider>{ui}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
