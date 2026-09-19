/* SkillsListColumn — left column of the Skills Lab: title + "Add Skill"
   dropdown (create / import), search, and the SkillCard list. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button, Dropdown, EmptyState, ErrorState, Icon, Skeleton } from "@/components/ui-client";
import { useSkills, useUpdateSkill } from "@/lib/hooks/skills";
import { SkillCard } from "../SkillCard/SkillCard";
import { ImportSkillModal } from "../ImportSkillModal/ImportSkillModal";
import { filterSkills, skillHref } from "./helpers";
import { s } from "./styles";

export function SkillsListColumn({ selectedId }: { selectedId?: string }) {
  const t = useTranslations("skills");
  const router = useRouter();
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const update = useUpdateSkill();
  const [search, setSearch] = React.useState("");
  const [importing, setImporting] = React.useState(false);

  const list = filterSkills(skills ?? [], search);

  return (
    <aside style={s.column}>
      {importing && <ImportSkillModal onClose={() => setImporting(false)} />}
      <div style={s.top}>
        <div style={s.header}>
          <h1 style={s.h1}>{t("list.title")}</h1>
          <Dropdown
            width={200}
            align="right"
            trigger={
              <Button kind="primary" size="sm" icon="Plus" iconRight="ChevronDown">
                {t("list.add")}
              </Button>
            }
            items={[
              { label: t("list.create"), icon: "Edit", onClick: () => router.push("/skills/new") },
              { label: t("list.import"), icon: "Upload", onClick: () => setImporting(true) },
            ]}
          />
        </div>
        <div style={s.search}>
          <Icon.Search size={13} style={s.searchIcon} aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("list.searchPlaceholder")}
            aria-label={t("list.searchLabel")}
            style={s.searchInput}
          />
        </div>
      </div>
      <div style={s.list}>
        {isLoading && (
          <div style={s.skeletons}>
            <Skeleton height={110} />
            <Skeleton height={110} />
            <Skeleton height={110} />
          </div>
        )}
        {isError && <ErrorState body={t("list.loadError")} onRetry={() => refetch()} />}
        {!isLoading && !isError && (skills ?? []).length === 0 && (
          <EmptyState icon="Sparkles" title={t("list.emptyTitle")} body={t("list.emptyBody")} />
        )}
        {(skills ?? []).length > 0 && list.length === 0 && (
          <p style={s.noMatches}>{t("list.noMatches", { query: search.trim() })}</p>
        )}
        {list.map((sk) => (
          <SkillCard
            key={sk.id}
            skill={sk}
            active={sk.id === selectedId}
            onClick={() => router.push(skillHref(sk.id, window.location.search))}
            onToggle={(enabled) => update.mutate({ id: sk.id, patch: { enabled } })}
          />
        ))}
      </div>
    </aside>
  );
}
