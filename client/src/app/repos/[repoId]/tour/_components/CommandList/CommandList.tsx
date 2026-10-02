/* CommandList — the run_locally commands, numbered from 1 in facts order
   (AC-76), each with a control that copies its exact text (AC-77). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { IconBtn } from "@/components/ui-client";
import { s } from "./styles";

export function CommandList({ commands }: { commands: string[] }) {
  const t = useTranslations("onboarding");
  const [copiedIndex, setCopiedIndex] = React.useState<number | null>(null);

  const copy = async (command: string, index: number) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedIndex(index);
      window.setTimeout(() => setCopiedIndex((i) => (i === index ? null : i)), 1500);
    } catch {
      // Clipboard unavailable — the command text is still selectable.
    }
  };

  if (commands.length === 0) return null;

  return (
    <ol style={s.list}>
      {commands.map((command, i) => (
        <li key={`${i}-${command}`} style={s.item}>
          <code className="mono" style={s.code}>
            {command}
          </code>
          <IconBtn
            icon={copiedIndex === i ? "Check" : "Copy"}
            label={copiedIndex === i ? t("tour.copied") : t("tour.copy", { command })}
            size={26}
            onClick={() => copy(command, i)}
          />
        </li>
      ))}
    </ol>
  );
}
