/* SkillsTab — the agent's skills (tab_1). Lists EVERY workspace skill: linked
   ones first in prompt order, then the unlinked ones alphabetically.

   Rules (spec 0006 Decisions):
   - checking an unlinked skill links it, enabled, at the end of the linked list;
   - unchecking keeps the link with enabled=false, so it keeps its position;
   - only LINKED rows are sortable — an unlinked skill has no prompt position
     until it is checked, so its handle is disabled;
   - sorting is disabled while a filter is active (a filtered view hides rows,
     so a drop position would be ambiguous);
   - a skill reaches the prompt only if checked AND globally enabled — the
     header count and token estimate count only those.
   Every change PUTs the full ordered link list, with an optimistic cache
   write (rolled back + toast on error) so a drag lands instantly. */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Badge, ErrorState, Skeleton, TextInput } from "@/components/ui-client";
import type { AgentSkill } from "@devdigest/shared";
import { useAgentSkills, useSetAgentSkills } from "@/lib/hooks/agents";
import { useSkills } from "@/lib/hooks/skills";
import { useToast } from "@/lib/toast";
import { SkillRow } from "./_components/SkillRow";
import { agentSkillsKey } from "./constants";
import {
  countEnabled,
  filterRows,
  mergeSkillRows,
  moveSkill,
  sumTokens,
  toAgentSkills,
  toPayload,
  toggleSkill,
  type SkillRowModel,
} from "./helpers";
import { s } from "./styles";

export function SkillsTab({ agentId }: { agentId: string }) {
  const t = useTranslations("agents");
  const toast = useToast();
  const qc = useQueryClient();
  const links = useAgentSkills(agentId);
  const skills = useSkills();
  const setSkills = useSetAgentSkills();
  const [query, setQuery] = React.useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (links.isError || skills.isError) {
    return (
      <ErrorState
        title={t("skills.loadError")}
        onRetry={() => {
          void links.refetch();
          void skills.refetch();
        }}
      />
    );
  }
  if (!links.data || !skills.data) {
    return (
      <div style={s.wrap}>
        <Skeleton height={24} width={220} />
        <Skeleton height={180} style={{ marginTop: 16 }} />
      </div>
    );
  }

  const rows = mergeSkillRows(links.data, skills.data);
  const filtering = query.trim() !== "";
  const visible = filterRows(rows, query);
  const linkedIds = rows.filter((r) => r.linked).map((r) => r.skill.id);

  const save = (next: SkillRowModel[]) => {
    const key = agentSkillsKey(agentId);
    const previous = qc.getQueryData<AgentSkill[]>(key);
    void qc.cancelQueries({ queryKey: key });
    qc.setQueryData<AgentSkill[]>(key, toAgentSkills(agentId, next));
    setSkills.mutate(
      { agentId, skills: toPayload(next) },
      {
        onError: () => {
          qc.setQueryData(key, previous);
          toast.error(t("skills.saveError"));
        },
      },
    );
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    save(moveSkill(rows, String(active.id), String(over.id)));
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("skills.title")}</h2>
        <Badge color="var(--accent-text)" bg="var(--accent-bg)">
          {t("skills.enabledCount", { linked: countEnabled(rows), total: rows.length })}
        </Badge>
        <div style={s.filter}>
          <TextInput
            value={query}
            onChange={setQuery}
            placeholder={t("skills.filterPlaceholder")}
            aria-label={t("skills.filterPlaceholder")}
          />
        </div>
      </div>
      <p style={s.hint}>{t("skills.orderHint")}</p>

      {rows.length === 0 ? (
        <p style={s.empty}>
          {t("skills.emptyBody")}{" "}
          <Link href="/skills" style={s.emptyLink}>
            {t("skills.emptyCta")}
          </Link>
        </p>
      ) : visible.length === 0 ? (
        <p style={s.empty}>{t("skills.noMatches", { q: query.trim() })}</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={linkedIds} strategy={verticalListSortingStrategy}>
            <ul style={s.list}>
              {visible.map((row) => (
                <SkillRow
                  key={row.skill.id}
                  row={row}
                  sortDisabled={filtering}
                  onToggle={(id, checked) => save(toggleSkill(rows, id, checked))}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {rows.length > 0 && <div style={s.footer}>{t("skills.tokens", { count: sumTokens(rows) })}</div>}
    </div>
  );
}
