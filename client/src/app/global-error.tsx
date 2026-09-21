/* Last-resort boundary: catches errors thrown by the ROOT layout itself, which
   `app/error.tsx` cannot — it lives inside that layout.

   Because it replaces the root layout when it renders, it must supply its own
   <html> and <body>, and it cannot rely on anything the layout provides:
   no NextIntlClientProvider (so no useTranslations), no Providers, no theme
   class. Everything here is therefore deliberately self-contained and inline —
   importing the design system would risk throwing again inside the handler.

   `reset()` is the Next 15 API (v16 renamed it `retry()`). */
"use client";

import React from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("Unhandled error in root layout:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f1115",
          color: "#e6e8ee",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div role="alert" style={{ textAlign: "center", padding: "40px 24px", maxWidth: 480 }}>
          <h1 style={{ fontSize: 18, margin: "0 0 8px" }}>DevDigest failed to start</h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: "#9aa1b1", margin: "0 0 20px" }}>
            {error.digest
              ? `A fatal error occurred in the application shell. Reference: ${error.digest}`
              : "A fatal error occurred in the application shell."}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              padding: "8px 16px",
              fontSize: 14,
              borderRadius: 6,
              border: "1px solid #2a2f3a",
              background: "#1a1d24",
              color: "#e6e8ee",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
