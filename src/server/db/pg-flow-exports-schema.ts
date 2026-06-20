import { pgTable, uuid, text, boolean, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/** Per-org on/off toggle for a flow's exported variables. Structure (which vars a
 *  flow CAN export) is code-declared on MasterFlowNode.exports; this only persists
 *  the enabled state. Org isolation via withOrgCore (app_ledger + GUC). */
export const flowVarExports = pgTable(
  'flow_var_exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    flowId: text('flow_id').notNull(),
    varKey: text('var_key').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ uniq: uniqueIndex('flow_var_exports_org_flow_key_uniq').on(t.orgId, t.flowId, t.varKey) }),
);

export type FlowVarExportRow = typeof flowVarExports.$inferSelect;
