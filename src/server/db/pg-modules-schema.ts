import { pgTable, text, boolean, timestamp, primaryKey } from 'drizzle-orm/pg-core';

/** Per-org enable state for hub-native modules ('crm', 'finances'). Absent row = enabled. */
export const appModules = pgTable(
  'app_modules',
  {
    orgId: text('org_id').notNull(),
    moduleId: text('module_id').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.orgId, t.moduleId] }) }),
);

export type AppModule = typeof appModules.$inferSelect;
