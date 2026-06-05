import { pgTable, text, boolean, bigint, index } from 'drizzle-orm/pg-core';

/**
 * Notes live in Supabase Postgres (the relational-core DB), NOT Turso — same
 * home as `flows`. Unlike flows (org-shared), notes are PERSONAL: visibility is
 * gated by `user_id` within a tenant. Timestamps are epoch-ms stored as bigint
 * with `mode: 'number'`, matching `flows.ts`.
 *
 * The body is a small scalar shell + an evolving JSON `data` document (see
 * `$lib/types/notes`), so the note/todo/easel shapes grow without a migration.
 * Images are referenced by `fileId` (cross-DB ref → Turso `files`), never inlined.
 */
export const notes = pgTable(
  'notes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id'), // org scope (cross-DB ref → Turso organization.id)
    userId: text('user_id'), // owner — notes are personal (gates visibility)
    kind: text('kind').notNull().default('note'), // 'note' | 'todo' | 'easel'
    title: text('title').notNull().default(''),
    color: text('color').notNull().default('default'),
    pinned: boolean('pinned').notNull().default(false),
    data: text('data').notNull().default('{}'), // JSON string; shape depends on kind
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => [index('notes_owner_idx').on(t.tenantId, t.userId), index('notes_updated_idx').on(t.updatedAt)],
);

export type NoteRow = typeof notes.$inferSelect;
export type NewNoteRow = typeof notes.$inferInsert;
