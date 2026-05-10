// TEMPORARY: duplicates @minion-stack/db's workspace_membership table.
// Swap to `import { workspaceMembership } from '@minion-stack/db/schema'`
// after that package publishes (Task 16 polish gate).
import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { user } from './auth';

export const workspaceMembership = sqliteTable(
	'workspace_membership',
	{
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		paperclipCompanyId: text('paperclip_company_id').notNull(),
		role: text('role').notNull().default('admin'),
		createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.userId, t.paperclipCompanyId] }),
		index('idx_workspace_membership_user').on(t.userId),
	],
);

export type WorkspaceMembership = typeof workspaceMembership.$inferSelect;
export type NewWorkspaceMembership = typeof workspaceMembership.$inferInsert;
