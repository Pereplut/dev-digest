import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  primaryKey,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { now } from "./_shared";
import { workspaces } from "./core";

export const SKILL_TYPES = [
  "rubric",
  "convention",
  "security",
  "custom",
] as const;

/**
 * A reusable markdown instruction block. Skills are TEXT ONLY: an enabled skill
 * linked to an agent is appended to that agent's system message; nothing in a
 * skill is ever executed (spec 0006).
 */
export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    type: text("type", { enum: SKILL_TYPES }).notNull(),
    source: text("source", {
      enum: [
        "manual",
        "imported_url",
        "imported_file",
        "extracted",
        "community",
      ],
    }).notNull(),
    body: text("body").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    version: integer("version").notNull().default(1),
    evidenceFiles: jsonb("evidence_files").$type<string[]>(),
    createdAt: now(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  // Names are how people (and imports) refer to a skill; also serves the
  // workspace_id lookup of the list endpoint.
  (t) => ({
    wsNameUq: unique("skills_workspace_name_uq").on(t.workspaceId, t.name),
  }),
);

export const skillVersions = pgTable(
  "skill_versions",
  {
    skillId: uuid("skill_id")
      .notNull()
      .references(() => skills.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    /** Full snapshot of the editable fields, so Restore/Diff need nothing else. */
    name: text("name").notNull().default(""),
    description: text("description").notNull().default(""),
    type: text("type", { enum: SKILL_TYPES }).notNull().default("custom"),
    body: text("body").notNull(),
    /** Optional change note typed on save ("Added Tests dimension"). */
    message: text("message"),
    createdAt: now(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.skillId, t.version] }) }),
);
