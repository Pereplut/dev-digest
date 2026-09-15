/* formatUsd — the one USD formatter for run cost (spec 0001-run-cost-badge).
   Always ≥3 digits after the point so cheap runs stay readable:
     ≥ $0.001 → 3 decimals          ("$0.014", "$0.060", "$1.500")
     < $0.001 → 2 significant digits ("$0.00042")
     0        → "$0.000"            (a free model, not missing data)
     null / negative / NaN → "—"    (unknown price — never "$0.00") */
export function formatUsd(costUsd: number | null | undefined): string {
  if (costUsd == null || !Number.isFinite(costUsd) || costUsd < 0) return "—";
  if (costUsd === 0) return "$0.000";
  if (costUsd >= 0.001) return `$${costUsd.toFixed(3)}`;
  const decimals = 1 - Math.floor(Math.log10(costUsd));
  return `$${costUsd.toFixed(decimals)}`;
}
