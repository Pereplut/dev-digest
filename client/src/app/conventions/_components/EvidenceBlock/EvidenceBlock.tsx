/* EvidenceBlock — the `file:line` header + the code the extractor proved.
   The snippet is always text the server re-read from the repository, never the
   model's own copy, so what is shown here is real repository content. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { IconBtn } from "@/components/ui-client";
import { s } from "./styles";

export function EvidenceBlock({ location, snippet }: { location: string; snippet: string }) {
  const t = useTranslations("conventions");
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is unavailable (insecure origin, denied permission) — the
      // snippet is selectable, so there is nothing to recover from.
    }
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <span className="mono" style={s.path}>
          {location}
        </span>
        <IconBtn
          icon={copied ? "Check" : "Copy"}
          label={copied ? t("card.copied") : t("card.copy", { path: location })}
          size={26}
          onClick={copy}
        />
      </div>
      <pre className="mono" style={s.code}>
        {snippet}
      </pre>
    </div>
  );
}
