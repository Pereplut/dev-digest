/* SkillRow — one workspace skill in the agent Skills tab: drag handle,
   checkbox, mono name, "off globally" note, type badge. Sortable via dnd-kit;
   only linked rows take part in sorting (see SkillsTab). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge, Checkbox, Icon } from "@/components/ui-client";
import { isChecked, type SkillRowModel } from "../../helpers";
import { SKILL_TYPE_COLORS } from "../../constants";
import { s } from "./styles";

export function SkillRow({
  row,
  sortDisabled,
  onToggle,
}: {
  row: SkillRowModel;
  /** True while a filter is active: a filtered view has no stable positions to drop onto. */
  sortDisabled: boolean;
  onToggle: (skillId: string, checked: boolean) => void;
}) {
  const t = useTranslations("agents");
  const { skill } = row;
  const dragDisabled = sortDisabled || !row.linked;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: skill.id,
    disabled: dragDisabled,
  });
  const checked = isChecked(row);
  const type = SKILL_TYPE_COLORS[skill.type];
  return (
    <li
      ref={setNodeRef}
      style={{ ...s.row(checked, isDragging), transform: CSS.Transform.toString(transform), transition }}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={dragDisabled}
        aria-label={t("skills.dragHandle", { name: skill.name })}
        title={sortDisabled ? t("skills.dragDisabledFiltered") : undefined}
        style={s.handle(dragDisabled)}
      >
        <Icon.Menu size={14} />
      </button>
      <Checkbox
        checked={checked}
        onChange={(v) => onToggle(skill.id, v)}
        label={
          <span className="mono" style={s.name(!skill.enabled)}>
            {skill.name}
          </span>
        }
      />
      {!skill.enabled && <span style={s.offNote}>{t("skills.offGlobally")}</span>}
      <span style={s.badge}>
        <Badge color={type.color} bg={type.bg}>
          {t(`skills.types.${skill.type}`)}
        </Badge>
      </span>
    </li>
  );
}
