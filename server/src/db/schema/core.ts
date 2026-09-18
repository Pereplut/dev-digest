import { sql } from 'drizzle-orm';
import { pgTable, uuid, text, jsonb, uniqueIndex, primaryKey } from 'drizzle-orm/pg-core';
import { now } from './_shared';

// ============================================================ Tenancy & core

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** UNIQUE: auth resolves the current user by email and takes the first row
      (adapters/auth/local.ts), so a duplicate would silently change identity. */
  email: text('email').notNull().unique('users_email_uq'),
  name: text('name').notNull(),
  createdAt: now(),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** UNIQUE for the same reason as users.email: the tenant is resolved by name
      and the first row wins, so a duplicate would reassign every request. */
  name: text('name').notNull().unique('workspaces_name_uq'),
  createdAt: now(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'member'] }).notNull().default('member'),
  },
  (t) => ({ pk: primaryKey({ columns: [t.workspaceId, t.userId] }) }),
);

/** Non-secret prefs/config. Secrets go via SecretsProvider, NOT here. */
export const settings = pgTable(
  'settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    value: jsonb('value'),
  },
  (t) => ({
    uq: uniqueIndex('settings_ws_user_key_uq').on(t.workspaceId, t.userId, t.key),
    /**
     * The index above does NOT constrain workspace-level rows: `user_id` is
     * nullable and Postgres treats NULLs as distinct, so `(ws, NULL, key)` could
     * be inserted without limit — and `PUT /settings` upserts on exactly that
     * target, so once a workspace-level setting existed the upsert appended a
     * duplicate instead of updating, leaving `rowsToSettings` to pick arbitrarily.
     *
     * A partial unique index is the standard fix and leaves the index above
     * untouched. (`nullsNotDistinct()` exists only on the unique-CONSTRAINT
     * builder, not on index builders, so taking that route would have changed
     * the Postgres object type of an existing index.)
     */
    globalUq: uniqueIndex('settings_ws_key_global_uq')
      .on(t.workspaceId, t.key)
      .where(sql`user_id is null`),
  }),
);
