import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/onboarding.json";
import TourError from "./error";

/* P2 (user-adopted) — no criterion. Mirrors the sibling `pulls/error.tsx`
   boundary: a render failure in the tour segment keeps the app chrome and
   shows the boundary copy instead of blanking the page. AppShell itself is
   mocked — its own chrome (nav, command palette, shortcuts) is not what this
   boundary is responsible for, and rendering it for real needs the whole
   repo/query/theme provider stack no other test in this package sets up. */
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

afterEach(cleanup);

function renderBoundary(error: Error) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      <TourError error={error} reset={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe("TourError", () => {
  it("renders the boundary copy for a thrown error", () => {
    renderBoundary(new Error("boom"));
    expect(screen.getByText("Couldn't load the onboarding tour")).toBeInTheDocument();
  });
});
