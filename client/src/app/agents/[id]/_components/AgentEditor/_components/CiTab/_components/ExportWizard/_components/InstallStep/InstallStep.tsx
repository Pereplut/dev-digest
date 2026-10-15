"use client";

import { useTranslations } from "next-intl";
import { Button, Card, MonoLink, SectionLabel } from "@/components/ui-client";
import { s } from "../../styles";

/** Step 4 — open the PR (exactly one request; confirm disabled while in
 *  flight — AC-68) or download the previewed files as a zip (AC-70). */
export function InstallStep({
  repo,
  fileCount,
  isOpeningPr,
  prUrl,
  prError,
  onOpenPr,
  onDownloadZip,
}: {
  repo: string;
  fileCount: number;
  isOpeningPr: boolean;
  prUrl: string | null;
  prError: string | null;
  onOpenPr: () => void;
  onDownloadZip: () => void;
}) {
  const t = useTranslations("ci");
  return (
    <div style={s.body}>
      <Card>
        <SectionLabel>{t("exportWizard.installCardTitle")}</SectionLabel>
        <div style={{ ...s.muted, marginBottom: 16 }}>
          {t("exportWizard.installCardBody", { repo: repo.trim(), count: fileCount })}
        </div>
        {prUrl ? (
          <div style={s.stack}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("exportWizard.installStep.prOpened")}</div>
            <MonoLink href={prUrl}>{t("exportWizard.installStep.viewPr")}</MonoLink>
          </div>
        ) : (
          <Button kind="primary" icon="GitPullRequest" onClick={onOpenPr} disabled={isOpeningPr}>
            {isOpeningPr ? t("exportWizard.installing") : t("exportWizard.install")}
          </Button>
        )}
        {prError && (
          <div role="alert" style={{ ...s.error, marginTop: 10 }}>
            {prError}
          </div>
        )}
      </Card>

      <Card>
        <SectionLabel>{t("exportWizard.installStep.zipTitle")}</SectionLabel>
        <div style={{ ...s.muted, marginBottom: 12 }}>{t("exportWizard.installStep.zipHint")}</div>
        <Button kind="secondary" icon="Copy" onClick={onDownloadZip}>
          {t("exportWizard.installStep.zipButton")}
        </Button>
      </Card>
    </div>
  );
}
