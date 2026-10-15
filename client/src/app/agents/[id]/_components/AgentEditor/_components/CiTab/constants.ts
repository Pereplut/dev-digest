import type { CiInstallationStatus } from "@devdigest/shared";

/** Placeholder for a value the run/installation does not have (never `0`). */
export const NO_VALUE = "—";

/** Badge colour per installation status. */
export const STATUS_COLOR: Record<CiInstallationStatus, string> = {
  pr_open: "var(--warn)",
  active: "var(--ok)",
  error: "var(--crit)",
};
