"use client";

import { useTranslations } from "next-intl";
import { MonoLink } from "@/components/ui-client";
import type { CiUpdateResult } from "@devdigest/shared";
import { s } from "../../styles";

/** Per-installation outcome of `POST /agents/:id/ci/update` (AC-60, AC-45). */
export function UpdateResults({
  results,
  repos,
}: {
  results: CiUpdateResult["results"];
  /** installation id -> repo */
  repos: Map<string, string>;
}) {
  const t = useTranslations("ci");
  return (
    <ul aria-label={t("ciTab.updateResults")} style={s.results}>
      {results.map((r) => (
        <li key={r.installation_id} style={r.ok ? s.resultOk : s.resultFail}>
          <strong className="mono">{repos.get(r.installation_id) ?? r.installation_id}</strong>{" "}
          {r.ok ? t("ciTab.updateOk") : t("ciTab.updateFailed", { error: r.error ?? "" })}
          {r.ok && r.pr_url && (
            <>
              {" "}
              <MonoLink href={r.pr_url}>{t("ciTab.viewPr")}</MonoLink>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
