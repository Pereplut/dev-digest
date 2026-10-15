/* CiTab — the agent's CI tab (spec 0022): one row per installation, a "Fail CI
   on" gate select, run history, "Update CI config" with per-installation
   outcomes, and "Add to CI" / "Add repository", which both open the same
   ExportWizard (AC-84). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, FormField, SelectInput, Skeleton } from "@/components/ui-client";
import type { Agent, CiFailOn } from "@devdigest/shared";
import { useCiInstallations, useCiRuns, useUpdateCi } from "@/lib/hooks/ci";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { CI_FAIL_ON_VALUES } from "../../constants";
import { hasGhaInstallation, repoById } from "./helpers";
import { s } from "./styles";
import { InstallationRow } from "./_components/InstallationRow/InstallationRow";
import { RunHistory } from "./_components/RunHistory/RunHistory";
import { UpdateResults } from "./_components/UpdateResults/UpdateResults";
import { ExportWizard } from "./_components/ExportWizard";

export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const updateAgent = useUpdateAgent();
  const updateCi = useUpdateCi(agent.id);
  const installations = useCiInstallations(agent.id);
  const runs = useCiRuns(agent.id);

  // Derived, not mirrored: the pending value while a save is in flight, else
  // the server's. A failed save therefore reverts the select on its own.
  const pendingFailOn = updateAgent.isPending ? updateAgent.variables?.patch.ci_fail_on : undefined;
  const ciFailOn: CiFailOn = pendingFailOn ?? agent.ci_fail_on;
  const [wizardOpen, setWizardOpen] = React.useState(false);

  const failOnOptions = CI_FAIL_ON_VALUES.map((v) => ({
    value: v,
    label: t(`ciTab.failCiOnOptions.${v}`),
  }));

  const handleFailOnChange = (v: string) => {
    const next = CI_FAIL_ON_VALUES.find((value) => value === v);
    if (!next) return;
    updateAgent.mutate({ id: agent.id, patch: { ci_fail_on: next } });
  };

  const list = installations.data;
  const hasRows = (list?.length ?? 0) > 0;
  const canUpdate = hasGhaInstallation(list);

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.headerText}>
          <h2 style={s.h2}>{t("ciTab.heading")}</h2>
          <p style={s.subtitle}>{t("ciTab.subtitle")}</p>
        </div>
        <Button kind="primary" size="sm" icon="Plus" onClick={() => setWizardOpen(true)}>
          {t("ciTab.addToCi")}
        </Button>
      </div>

      <div style={s.failOn}>
        <FormField label={t("ciTab.failCiOn")} hint={t("ciTab.failCiOnHint")}>
          <SelectInput value={ciFailOn} onChange={handleFailOnChange} options={failOnOptions} />
        </FormField>
        {updateAgent.isError && (
          <div role="alert" style={s.resultFail}>
            {t("ciTab.failOnSaveFailed", { error: updateAgent.error.message })}
          </div>
        )}
      </div>

      {installations.isLoading && (
        <div style={s.stack}>
          <Skeleton height={80} />
          <Skeleton height={80} />
        </div>
      )}

      {installations.isError && <ErrorState body={t("ciTab.loadError")} onRetry={() => installations.refetch()} />}

      {installations.isSuccess && !hasRows && (
        <EmptyState
          icon="Workflow"
          title={t("ciTab.heading")}
          body={t("ciTab.empty")}
          cta={t("ciTab.addToCi")}
          onCta={() => setWizardOpen(true)}
        />
      )}

      {installations.isSuccess && hasRows && (
        <div style={s.list}>
          {(list ?? []).map((installation) => (
            <InstallationRow key={installation.id} installation={installation} />
          ))}
          <div style={s.addRow}>
            <span style={s.meta}>{t("ciTab.addRepositoryHint")}</span>
            <Button kind="secondary" size="sm" icon="Plus" onClick={() => setWizardOpen(true)}>
              {t("ciTab.addRepository")}
            </Button>
          </div>
        </div>
      )}

      <div style={s.stack}>
        <div style={s.updateBar}>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            disabled={!canUpdate || updateCi.isPending}
            loading={updateCi.isPending}
            onClick={() => updateCi.mutate()}
          >
            {updateCi.isPending ? t("ciTab.updating") : t("ciTab.update")}
          </Button>
          <p style={s.note}>{canUpdate ? t("ciTab.updateDiscardNote") : t("ciTab.updateNoInstallations")}</p>
        </div>
        {updateCi.isError && (
          <div role="alert" style={s.resultFail}>
            {t("ciTab.updateRequestFailed", { error: updateCi.error.message })}
          </div>
        )}
        {updateCi.data && <UpdateResults results={updateCi.data.results} repos={repoById(list)} />}
      </div>

      <div style={s.stack}>
        <h3 style={s.h2}>{t("ciTab.runHistory")}</h3>
        {runs.isLoading && <Skeleton height={60} />}
        {runs.isError && <ErrorState body={t("ciTab.runsLoadError")} onRetry={() => runs.refetch()} />}
        {runs.isSuccess && <RunHistory runs={runs.data} />}
      </div>

      {wizardOpen && (
        <ExportWizard agentId={agent.id} agentName={agent.name} onClose={() => setWizardOpen(false)} />
      )}
    </div>
  );
}
