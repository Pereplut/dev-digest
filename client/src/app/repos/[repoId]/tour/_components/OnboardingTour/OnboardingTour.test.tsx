import { describe, it, expect, afterEach, vi } from "vitest";
import { act, render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingReason, OnboardingSection, OnboardingSectionKind, OnboardingStatus, OnboardingTour as OnboardingTourData } from "@/lib/types";
import { TOUR_POLL_INTERVAL_MS, TOUR_POLL_MAX_ATTEMPTS } from "@/lib/hooks/onboarding";
import messages from "../../../../../../../messages/en/onboarding.json";
import { OnboardingTour } from "./OnboardingTour";

/* Covers the AC-47…AC-87 rows of spec 0017's test plan. Real hooks (real
   TanStack Query + the real `useOnboardingTour` poll) over a mocked `fetch` —
   the poll ceiling (AC-52, AC-87) is the hook's own logic, so mocking the
   hook away would stop testing it. */

const SECTION_KINDS: OnboardingSectionKind[] = [
  "architecture",
  "critical_paths",
  "run_locally",
  "reading_path",
  "first_tasks",
];

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  } as unknown as Response;
}

function makeSection(kind: OnboardingSectionKind, over: Partial<OnboardingSection> = {}): OnboardingSection {
  return {
    kind,
    title: "INJECTED", // never read — AC-48 asserts headings come from i18n, not this.
    body: `Body for ${kind}.`,
    diagram: null,
    links: [],
    generated: true,
    degraded_reason: null,
    dropped_refs: 0,
    truncated: false,
    items: [],
    commands: [],
    ...over,
  };
}

function makeTour(over: Partial<OnboardingTourData> = {}): OnboardingTourData {
  return {
    sections: SECTION_KINDS.map((k) => makeSection(k)),
    status: "done" as OnboardingStatus,
    reason: null,
    generated_at: "2026-10-01T10:00:00.000Z",
    files_indexed: 120,
    ...over,
  };
}

/** Routes fetch by method + path suffix; `state.tour` is read fresh on every
    GET, so a test can mutate it between timer advances to simulate a poll's
    next answer. */
function stubFetch(state: { tour: OnboardingTourData }) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET" && url.endsWith("/onboarding")) return response(state.tour);
    if (method === "POST" && url.endsWith("/onboarding")) return response({ job_id: "job-1" });
    if (method === "POST" && url.endsWith("/resync")) return response({ status: "accepted" });
    throw new Error(`unexpected fetch: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function renderTour(state: { tour: OnboardingTourData }, repoFullName = "acme/payments-api") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
        <OnboardingTour repoId="r1" repoFullName={repoFullName} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OnboardingTour — layout, headings and collapsibles (AC-47, AC-48, AC-49, AC-70, AC-71)", () => {
  it("renders a five-link TOC in contract order, i18n headings (never the API title), and toggles on click", async () => {
    stubFetch({ tour: makeTour() });
    renderTour({ tour: makeTour() });

    const headings = await screen.findAllByRole("button", { name: /Architecture|Critical Paths|Run Locally|Reading Path|First Tasks/ });
    expect(headings).toHaveLength(5);
    // Contract order, matching section ids.
    expect(headings.map((h) => h.textContent)).toEqual([
      expect.stringContaining("Architecture"),
      expect.stringContaining("Critical Paths"),
      expect.stringContaining("Run Locally"),
      expect.stringContaining("Reading Path"),
      expect.stringContaining("First Tasks"),
    ]);
    expect(screen.queryByText("INJECTED")).not.toBeInTheDocument();

    for (const kind of SECTION_KINDS) {
      expect(document.getElementById(kind)).not.toBeNull();
    }
    const toc = screen.getByRole("navigation");
    const links = within(toc).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(SECTION_KINDS.map((k) => `#${k}`));

    // AC-70: all five expanded on mount.
    for (const h of headings) expect(h).toHaveAttribute("aria-expanded", "true");

    // AC-49: clicking a header flips aria-expanded and hides the body.
    const user = userEvent.setup();
    const archHeader = screen.getByRole("button", { name: "Architecture" });
    await user.click(archHeader);
    expect(archHeader).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Body for architecture.")).not.toBeInTheDocument();
  });

  it("expands a collapsed section when its TOC link is activated (AC-71)", async () => {
    stubFetch({ tour: makeTour() });
    renderTour({ tour: makeTour() });

    const user = userEvent.setup();
    const header = await screen.findByRole("button", { name: "First Tasks" });
    await user.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("link", { name: "First Tasks" }));
    expect(header).toHaveAttribute("aria-expanded", "true");
  });

  it("hides the TOC below the md breakpoint, as a class (AC-72)", async () => {
    stubFetch({ tour: makeTour() });
    renderTour({ tour: makeTour() });
    const toc = await screen.findByRole("navigation");
    expect(toc.className).toContain("hidden");
    expect(toc.className).toContain("md:block");
  });
});

describe("OnboardingTour — status text (AC-50, AC-51, AC-54)", () => {
  const cases: { status: OnboardingStatus; reason: OnboardingReason | null; expect: string }[] = [
    { status: "not_generated", reason: null, expect: "This tour has not been generated yet." },
    { status: "running", reason: null, expect: "Generating the tour…" },
    { status: "partial", reason: null, expect: "The tour was only partially generated." },
    { status: "failed", reason: null, expect: "The last generation failed." },
    { status: "failed", reason: "flag_off", expect: "Repository intelligence is turned off for this repository." },
    { status: "failed", reason: "no_clone", expect: "This repository has not been cloned yet." },
    { status: "failed", reason: "not_indexed", expect: "This repository has not been indexed yet." },
    { status: "partial", reason: "no_source_files", expect: "No supported source files were found in this repository." },
    { status: "failed", reason: "index_incomplete", expect: "The index did not produce enough data for a tour." },
  ];

  for (const c of cases) {
    it(`status=${c.status} reason=${c.reason} renders the i18n sentence, not the enum`, async () => {
      const tour = makeTour({ status: c.status, reason: c.reason });
      stubFetch({ tour });
      renderTour({ tour });
      const el = await screen.findByRole("status", { name: new RegExp(c.expect.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
      expect(el.textContent).toContain(c.expect);
      expect(el.textContent).not.toMatch(/^(not_generated|running|partial|failed|flag_off|no_clone|not_indexed|no_source_files|index_incomplete|generation_failed)$/);
    });
  }

  it("shows the files_indexed count in the subline (AC-51)", async () => {
    const tour = makeTour({ files_indexed: 342 });
    stubFetch({ tour });
    renderTour({ tour });
    expect(await screen.findByText(/342 files/)).toBeInTheDocument();
  });

  it("appends the dropped-refs count to the status text when > 0, and shows it alone on a done tour (AC-54)", async () => {
    const dropped = makeTour({
      status: "done",
      sections: SECTION_KINDS.map((k) => makeSection(k, { dropped_refs: k === "architecture" ? 2 : 0 })),
    });
    stubFetch({ tour: dropped });
    renderTour({ tour: dropped });
    const el = await screen.findByRole("status", { name: /2 references were removed/ });
    expect(el.textContent).toMatch(/2 references were removed/);
  });

  it("renders no status element on a clean done tour", async () => {
    const tour = makeTour({ status: "done", reason: null });
    stubFetch({ tour });
    renderTour({ tour });
    await screen.findByRole("button", { name: "Architecture" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("OnboardingTour — generation_failed over a shown good tour (AC-60)", () => {
  it("states both the failed refresh and the age of the version on screen", async () => {
    const tour = makeTour({
      status: "partial",
      reason: "generation_failed",
      generated_at: "2026-09-29T10:00:00.000Z", // two days before the fixed "now" below
    });
    vi.setSystemTime(new Date("2026-10-01T10:00:00.000Z"));
    stubFetch({ tour });
    renderTour({ tour });
    const el = await screen.findByRole("status", { name: /The last regeneration failed\./ });
    expect(el.textContent).toContain("The last regeneration failed.");
    expect(el.textContent).toMatch(/2 days ago/);
    vi.useRealTimers();
  });

  it("does not render the failed/age phrasing on a clean done tour", async () => {
    const tour = makeTour({ status: "done", reason: null });
    stubFetch({ tour });
    renderTour({ tour });
    await screen.findByRole("button", { name: "Architecture" });
    expect(screen.queryByText(/Showing the version generated/)).not.toBeInTheDocument();
  });
});

describe("OnboardingTour — fallback chips and the reading_path note (AC-61, AC-62)", () => {
  it("renders a fallback chip on exactly the generated:false sections", async () => {
    const tour = makeTour({
      sections: SECTION_KINDS.map((k, i) => makeSection(k, { generated: i < 2 ? false : true })),
    });
    stubFetch({ tour });
    renderTour({ tour });
    expect(await screen.findAllByText("Not generated")).toHaveLength(2);
  });

  it("always shows the import-graph centrality note inside reading_path", async () => {
    const tour = makeTour();
    stubFetch({ tour });
    renderTour({ tour });
    await screen.findByRole("button", { name: "Reading Path" });
    expect(screen.getByText(/import graph/)).toBeInTheDocument();
  });
});

describe("OnboardingTour — Re-index control (AC-63, AC-64)", () => {
  it("renders under not_indexed and index_incomplete, and POSTs /repos/r1/resync", async () => {
    const tour = makeTour({ status: "failed", reason: "not_indexed" });
    const mock = stubFetch({ tour });
    renderTour({ tour });
    const user = userEvent.setup();
    const btn = await screen.findByRole("button", { name: "Re-index" });
    await user.click(btn);
    expect(mock).toHaveBeenCalledWith(expect.stringContaining("/repos/r1/resync"), expect.objectContaining({ method: "POST" }));
  });

  it("renders under index_incomplete", async () => {
    const tour = makeTour({ status: "failed", reason: "index_incomplete" });
    stubFetch({ tour });
    renderTour({ tour });
    expect(await screen.findByRole("button", { name: "Re-index" })).toBeInTheDocument();
  });

  it("renders no Re-index control under no_source_files", async () => {
    const tour = makeTour({ status: "partial", reason: "no_source_files" });
    stubFetch({ tour });
    renderTour({ tour });
    await screen.findByRole("button", { name: "Architecture" });
    expect(screen.queryByRole("button", { name: "Re-index" })).not.toBeInTheDocument();
  });

  it("renders no Re-index control under flag_off or no_clone", async () => {
    for (const reason of ["flag_off", "no_clone"] as const) {
      const tour = makeTour({ status: "failed", reason });
      stubFetch({ tour });
      const { unmount } = renderTour({ tour });
      await screen.findByRole("button", { name: "Architecture" });
      expect(screen.queryByRole("button", { name: "Re-index" })).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe("OnboardingTour — Regenerate (AC-52, AC-53, AC-73)", () => {
  it("is disabled under each blocking reason", async () => {
    for (const reason of ["flag_off", "no_clone", "not_indexed", "index_incomplete"] as const) {
      const tour = makeTour({ status: "failed", reason });
      stubFetch({ tour });
      const { unmount } = renderTour({ tour });
      const btn = await screen.findByRole("button", { name: "Regenerate" });
      expect(btn).toBeDisabled();
      unmount();
    }
  });

  it("is enabled on a done tour and issues the POST with no confirmation dialog", async () => {
    const tour = makeTour();
    const mock = stubFetch({ tour });
    renderTour({ tour });
    const user = userEvent.setup();
    const btn = await screen.findByRole("button", { name: "Regenerate" });
    expect(btn).not.toBeDisabled();
    await user.click(btn);
    expect(mock).toHaveBeenCalledWith(expect.stringContaining("/repos/r1/onboarding"), expect.objectContaining({ method: "POST" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is disabled while running", async () => {
    const tour = makeTour({ status: "running", reason: null, generated_at: null, files_indexed: null });
    stubFetch({ tour });
    renderTour({ tour });
    const btn = await screen.findByRole("button", { name: "Regenerate" });
    expect(btn).toBeDisabled();
  });
});

describe("OnboardingTour — header (AC-57, AC-78)", () => {
  it("shows only the repo name segment and exactly one time element", async () => {
    const tour = makeTour({ generated_at: "2026-10-01T08:00:00.000Z" });
    stubFetch({ tour });
    renderTour({ tour }, "acme/payments-api");
    expect(await screen.findByRole("heading", { name: "payments-api" })).toBeInTheDocument();
    expect(screen.queryByText("acme/")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Last refreshed/)).toHaveLength(1);
  });

  it("clamps a future generated_at to 'just now'", async () => {
    vi.setSystemTime(new Date("2026-10-01T10:00:00.000Z"));
    const tour = makeTour({ generated_at: "2026-10-01T10:00:30.000Z" });
    stubFetch({ tour });
    renderTour({ tour });
    expect(await screen.findByText(/Last refreshed just now/)).toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe("OnboardingTour — loading (AC-74)", () => {
  it("shows a skeleton and no section body while the first GET is in flight", async () => {
    let resolveFetch!: (r: Response) => void;
    const mock = vi.fn(() => new Promise<Response>((resolve) => (resolveFetch = resolve)));
    vi.stubGlobal("fetch", mock);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
          <OnboardingTour repoId="r1" repoFullName="acme/payments-api" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("status", { name: "Loading the tour…" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Architecture" })).not.toBeInTheDocument();

    await act(async () => {
      resolveFetch(response(makeTour()));
      await Promise.resolve();
    });
    expect(await screen.findByRole("button", { name: "Architecture" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading the tour…" })).not.toBeInTheDocument();
  });
});

describe("OnboardingTour — run_locally commands (AC-76, AC-77)", () => {
  it("renders an ordered list in facts order, each with a working copy control", async () => {
    // `userEvent.setup()` installs its own clipboard stub (for copy/paste
    // testing), so ours must be defined AFTER setup() or it gets overwritten.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const tour = makeTour({
      sections: SECTION_KINDS.map((k) =>
        k === "run_locally" ? makeSection(k, { commands: ["pnpm install", "pnpm dev"] }) : makeSection(k),
      ),
    });
    stubFetch({ tour });
    renderTour({ tour });

    await screen.findByRole("button", { name: "Run Locally" });
    const list = document.querySelector("ol")!;
    expect(list).not.toBeNull();
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      expect.stringContaining("pnpm install"),
      expect.stringContaining("pnpm dev"),
    ]);

    const copyButtons = screen.getAllByRole("button", { name: /^Copy / });
    expect(copyButtons).toHaveLength(2);
    await user.click(copyButtons[1]!);
    expect(writeText).toHaveBeenCalledWith("pnpm dev");
  });
});

describe("OnboardingTour — last good tour kept while running (AC-79)", () => {
  it("renders all five bodies while status is running", async () => {
    const tour = makeTour({ status: "running", reason: null, generated_at: "2026-10-01T08:00:00.000Z" });
    stubFetch({ tour });
    renderTour({ tour });
    for (const kind of SECTION_KINDS) {
      await screen.findByText(`Body for ${kind}.`);
    }
  });
});

describe("OnboardingTour — poll ceiling (AC-52, AC-87)", () => {
  it("polls every TOUR_POLL_INTERVAL_MS while running, stops at 41 fetches, re-enables Regenerate and shows the reload sentence", async () => {
    vi.useFakeTimers();
    const state = { tour: makeTour({ status: "running", reason: null, generated_at: null, files_indexed: null }) };
    const mock = stubFetch(state);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
          <OnboardingTour repoId="r1" repoFullName="acme/payments-api" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TOUR_POLL_INTERVAL_MS * TOUR_POLL_MAX_ATTEMPTS);
    });
    expect(mock).toHaveBeenCalledTimes(TOUR_POLL_MAX_ATTEMPTS + 1);

    // No further fetch even after another interval elapses.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TOUR_POLL_INTERVAL_MS * 2);
    });
    expect(mock).toHaveBeenCalledTimes(TOUR_POLL_MAX_ATTEMPTS + 1);

    expect(screen.getByRole("button", { name: "Regenerate" })).not.toBeDisabled();
    expect(screen.getByRole("status").textContent).toContain("reload the page");

    vi.useRealTimers();
  });

  it("stops polling at attempt 2 once the tour flips to done, with no reload sentence", async () => {
    vi.useFakeTimers();
    const state = { tour: makeTour({ status: "running", reason: null, generated_at: null, files_indexed: null }) };
    const mock = stubFetch(state);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
          <OnboardingTour repoId="r1" repoFullName="acme/payments-api" />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(mock).toHaveBeenCalledTimes(1);

    state.tour = makeTour({ status: "done", reason: null });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TOUR_POLL_INTERVAL_MS);
    });
    expect(mock).toHaveBeenCalledTimes(2);

    // No third fetch — polling stopped once status left "running".
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TOUR_POLL_INTERVAL_MS * 3);
    });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/reload the page/)).not.toBeInTheDocument();

    vi.useRealTimers();
  });
});
