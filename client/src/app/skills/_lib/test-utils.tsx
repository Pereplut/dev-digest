/* Test-only helpers for the Skills Lab component tests (not imported by app code). */
import React from "react";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Skill } from "@devdigest/shared";
import messages from "../../../../messages/en/skills.json";
import { ToastProvider } from "../../../lib/toast";

export function makeSkill(over: Partial<Skill> = {}): Skill {
  return {
    id: "sk1",
    name: "pr-quality-rubric",
    description: "Rubric for evaluating overall PR quality across dimensions.",
    type: "rubric",
    source: "manual",
    body: "Evaluate the pull request.\n\n## Correctness\n- Does it work?",
    enabled: true,
    version: 3,
    token_count: 120,
    stats: { agent_count: 3, pull_rate: 0.71, accept_rate: 0.74 },
    updated_at: "2026-09-01T10:00:00.000Z",
    ...over,
  };
}

/** Renders with the `skills` i18n namespace, a fresh QueryClient and the toast provider. */
export function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
        <ToastProvider>{ui}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}
