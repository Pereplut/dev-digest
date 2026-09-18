/* Error boundary for the PR detail segment.

   This is the densest surface in the app and the most likely to throw: it
   renders a diff viewer, findings, a run timeline and a trace drawer, several
   of which mount third-party libraries (mermaid, recharts, react-markdown).
   Scoped here so one bad PR does not take down the whole app — the shell and
   the PR list navigation survive.

   `reset()` is the Next 15 API (v16 renamed it `retry()`). */
"use client";

import React from "react";
import { ErrorState } from "@/components/ui-client";

export default function PrDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Error in the PR detail segment:", error);
  }, [error]);

  return (
    <ErrorState
      title="Couldn't load this pull request"
      body="Something went wrong rendering the pull request. Retrying may help; if not, check that the DevDigest engine is running."
      onRetry={reset}
    />
  );
}
