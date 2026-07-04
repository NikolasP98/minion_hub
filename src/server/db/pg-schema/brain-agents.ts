import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * P4.1 AI-Brains — org-level "Brain Agent Template". One row per org: the
 * shared identity/model/instructions every brain's managing gateway agent
 * (archetype 'brain') is provisioned/reconfigured from. Reconfiguring this
 * template re-patches every brain agent in the org (`fanOutTemplate`).
 *
 * Filed alongside `pg-schema/brains.ts` per the same convention (queried via
 * `getCoreDb().select().from(table)`, not `@minion-stack/db`). Companion RLS
 * lives in `supabase/migrations/20260703130000_brain_agents.sql`.
 */

export const brainAgentTemplates = pgTable('brain_agent_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: text('org_id').notNull().unique(),
  namePrefix: text('name_prefix').notNull().default('Brain'),
  emoji: text('emoji'),
  /** Nullable — blank means "use the gateway default model". */
  model: text('model'),
  /** Supports `{{brain_name}}` / `{{brain_description}}` placeholders — see
   *  `renderTemplate` in brain-agents.service.ts. */
  instructions: text('instructions').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
export type BrainAgentTemplate = typeof brainAgentTemplates.$inferSelect;
