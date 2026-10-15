/* ExportWizard — Target → Preview → Configure → Install (spec 0022).
   Owns what the vendored Modal lacks: the Escape key and returning focus to
   the control that opened it (AC-71). An edited workflow reaches BOTH the
   open_pr body (`workflow_override`) and the zip (AC-64). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, ExportWizardSteps, Modal } from "@/components/ui-client";
import type { CiFile, CiTrigger } from "@devdigest/shared";
import { useExportCi } from "@/lib/hooks/ci";
import { useActiveRepo } from "@/lib/repo-context";
import { DEFAULT_POST_AS, DEFAULT_TRIGGERS, MODAL_WIDTH, STEP_KEYS, WORKFLOW_PATH } from "./constants";
import { buildExportBody, findWorkflow, isValidRepo, withEditedWorkflow, type ExportChoices } from "./helpers";
import { s } from "./styles";
import type { PostAs, TriggerState, WizardStep } from "./types";
import { TargetStep } from "./_components/TargetStep/TargetStep";
import { PreviewStep } from "./_components/PreviewStep/PreviewStep";
import { ConfigureStep } from "./_components/ConfigureStep/ConfigureStep";
import { InstallStep } from "./_components/InstallStep/InstallStep";
import { buildZip, downloadBlob } from "./zip";

export function ExportWizard({
  agentId,
  agentName,
  onClose,
}: {
  agentId: string;
  agentName: string;
  onClose: () => void;
}) {
  const t = useTranslations("ci");
  const exportCi = useExportCi(agentId);
  const { activeRepo } = useActiveRepo();

  const [step, setStep] = React.useState<WizardStep>(0);
  const [repo, setRepo] = React.useState(() => activeRepo?.full_name ?? "");
  const [triggers, setTriggers] = React.useState<TriggerState>(DEFAULT_TRIGGERS);
  const [postAs, setPostAs] = React.useState<PostAs>(DEFAULT_POST_AS);
  const [files, setFiles] = React.useState<CiFile[] | null>(null);
  const [selectedPath, setSelectedPath] = React.useState(WORKFLOW_PATH);
  const [edited, setEdited] = React.useState(false);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [prUrl, setPrUrl] = React.useState<string | null>(null);
  const [prError, setPrError] = React.useState<string | null>(null);

  // Escape closes the wizard; focus returns to whatever opened it.
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  React.useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // Only the newest `files` request may update the preview.
  const latestRequest = React.useRef(0);
  const loadPreview = async (choices: ExportChoices) => {
    const requestId = ++latestRequest.current;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const result = await exportCi.mutateAsync(buildExportBody("files", choices));
      if (requestId === latestRequest.current) setFiles(result.files);
    } catch (err) {
      if (requestId === latestRequest.current) {
        setPreviewError(err instanceof Error ? err.message : t("exportWizard.genericError"));
      }
    } finally {
      if (requestId === latestRequest.current) setPreviewLoading(false);
    }
  };

  const goNext = () => {
    if (step === 0 && !edited) void loadPreview({ repo, triggers, postAs });
    setStep((v) => Math.min(v + 1, 3) as WizardStep);
  };
  const goBack = () => setStep((v) => Math.max(v - 1, 0) as WizardStep);

  // AC-81: an unedited workflow follows the Configure choices; an edited one doesn't.
  const handleToggleTrigger = (key: CiTrigger) => {
    const next = { ...triggers, [key]: !triggers[key] };
    setTriggers(next);
    if (!edited) void loadPreview({ repo, triggers: next, postAs });
  };
  const handlePostAs = (next: PostAs) => {
    setPostAs(next);
    if (!edited) void loadPreview({ repo, triggers, postAs: next });
  };

  const handleWorkflowChange = (contents: string) => {
    setEdited(true);
    setFiles((prev) => (prev ? withEditedWorkflow(prev, contents) : prev));
  };

  const handleOpenPr = async () => {
    setPrError(null);
    const override = edited ? findWorkflow(files)?.contents : undefined;
    try {
      const result = await exportCi.mutateAsync(
        buildExportBody("open_pr", { repo, triggers, postAs }, override),
      );
      setPrUrl(result.pr_url);
    } catch (err) {
      setPrError(err instanceof Error ? err.message : t("exportWizard.genericError"));
    }
  };

  const handleDownloadZip = () => {
    if (!files) return;
    downloadBlob(buildZip(files.map((f) => ({ path: f.path, contents: f.contents }))), "devdigest-ci-gha.zip");
  };

  const canContinue = step !== 0 || isValidRepo(repo);

  return (
    <Modal
      width={MODAL_WIDTH}
      title={t("exportWizard.title")}
      subtitle={t("exportWizard.subtitle", { agentName: agentName || t("exportWizard.thisAgent") })}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="ghost" onClick={step === 0 ? onClose : goBack}>
            {t("exportWizard.back")}
          </Button>
          {step < 3 && (
            <Button kind="primary" onClick={goNext} disabled={!canContinue}>
              {t("exportWizard.continue")}
            </Button>
          )}
        </div>
      }
    >
      <div style={s.stepsBar}>
        <ExportWizardSteps step={step} labels={STEP_KEYS.map((key) => t(`exportWizard.steps.${key}`))} />
      </div>

      {step === 0 && <TargetStep repo={repo} onRepoChange={setRepo} />}
      {step === 1 && (
        <PreviewStep
          loading={previewLoading}
          error={previewError}
          files={files}
          selectedPath={selectedPath}
          onSelect={setSelectedPath}
          onWorkflowChange={handleWorkflowChange}
        />
      )}
      {step === 2 && (
        <ConfigureStep
          triggers={triggers}
          onToggleTrigger={handleToggleTrigger}
          postAs={postAs}
          onChangePostAs={handlePostAs}
          edited={edited}
        />
      )}
      {step === 3 && (
        <InstallStep
          repo={repo}
          fileCount={files?.length ?? 0}
          isOpeningPr={exportCi.isPending}
          prUrl={prUrl}
          prError={prError}
          onOpenPr={handleOpenPr}
          onDownloadZip={handleDownloadZip}
        />
      )}
    </Modal>
  );
}
