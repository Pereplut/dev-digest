/* TraceSection — collapsible titled section used throughout the trace tab. */
"use client";

import React from "react";
import { Icon } from "@/components/ui-client";
import { s } from "../../styles";

export function TraceSection({
  icon,
  title,
  right,
  children,
  defaultOpen = true,
}: {
  icon: "Settings" | "Gauge" | "FileText" | "Wrench" | "Code" | "AlertOctagon";
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const I = Icon[icon];
  return (
    <div style={s.section}>
      {/* A real <button>: this header contains no interactive children, so it
          can be one — which gives keyboard focus, Enter/Space and the correct
          role for free, instead of a div nobody can reach without a mouse. */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ ...s.sectionHead, width: "100%", background: "none", border: "none", font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer" }}
      >
        <I size={15} style={s.sectionIcon} />
        <span style={s.sectionTitle}>{title}</span>
        {right}
        <Icon.ChevronDown size={15} style={s.chevron(open)} />
      </button>
      {open && <div style={s.sectionBody}>{children}</div>}
    </div>
  );
}
