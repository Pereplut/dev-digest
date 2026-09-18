/* Route-segment error boundary for the whole app.

   Next renders this when a Client Component below it throws during render.
   Before this existed, any such throw escaped to Next's built-in handler: an
   unstyled full-page error with no retry and no app chrome. That was a real
   risk here, not a theoretical one — 5 of 7 pages are client components and
   they render third-party code (mermaid, recharts, react-markdown).

   `reset()` re-renders the segment. NOTE: this is the Next 15 API. Current
   next.js docs describe v16, where it is `retry()` — see client/INSIGHTS.md
   ("The client is on Next 15, but current Next.js docs describe 16"). */
"use client";

import React from "react";
import { ErrorState } from "@/components/ui-client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Surface it for local debugging; Next strips message/stack in production
    // builds and leaves only `digest`.
    console.error("Unhandled error in app segment:", error);
  }, [error]);

  return (
    <ErrorState
      fullScreen
      title="Something went wrong"
      body={
        error.digest
          ? `An unexpected error occurred. Reference: ${error.digest}`
          : "An unexpected error occurred while rendering this page."
      }
      onRetry={reset}
    />
  );
}
