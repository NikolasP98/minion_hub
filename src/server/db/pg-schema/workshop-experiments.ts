/**
 * Workshop experiments schema (Supabase Postgres — the relational-core DB).
 *
 * Feature data lives in Supabase PG, NOT Turso (Turso is telemetry/operational
 * only). Same home + conventions as `notes.ts`/`flows.ts`: text ids, epoch-ms
 * `bigint mode:'number'` timestamps, plain-text tenant/user scope (cross-DB ref
 * → Turso `organization.id`, no FK), app-level tenant gating in the service.
 *
 * Queried via getCoreDb().select().from(table). Applied via the
 * apply-workshop-pg one-off (CREATE TABLE IF NOT EXISTS against SUPABASE_DB_URL).
 */

import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const workshopPromptCategories = pgTable(
  'workshop_prompt_categories',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    name: text('name').notNull(),
    source: text('source').notNull(), // 'suggested' | 'user'
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => [uniqueIndex('uq_wpc_tenant_name').on(t.tenantId, t.name)],
);

export const workshopComparisonRuns = pgTable(
  'workshop_comparison_runs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    serverId: text('server_id'),
    userId: text('user_id'),
    prompt: text('prompt').notNull(),
    system: text('system'),
    params: text('params'), // JSON: { temperature?, maxTokens?, reasoning? }
    modelIds: text('model_ids').notNull(), // JSON: { provider, modelId }[]
    blind: boolean('blind').notNull().default(false),
    categoryIds: text('category_ids'), // JSON: string[]
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    finishedAt: bigint('finished_at', { mode: 'number' }),
  },
  (t) => [index('idx_wcr_tenant').on(t.tenantId)],
);

export const workshopComparisonOutputs = pgTable(
  'workshop_comparison_outputs',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    modelId: text('model_id').notNull(),
    provider: text('provider'),
    output: text('output'),
    latencyMs: integer('latency_ms'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: doublePrecision('cost_usd'),
    error: text('error'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => [index('idx_wco_run').on(t.runId)],
);

export const workshopRankings = pgTable(
  'workshop_rankings',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    modelId: text('model_id').notNull(),
    rank: integer('rank').notNull(),
    picked: boolean('picked').notNull().default(false),
    userId: text('user_id'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => [index('idx_wr_run').on(t.runId), index('idx_wr_model').on(t.modelId)],
);

export const workshopGroupchatRuns = pgTable(
  'workshop_groupchat_runs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    serverId: text('server_id'),
    userId: text('user_id'),
    prompt: text('prompt').notNull(),
    status: text('status').notNull().default('draft'), // draft|queued|running|paused|done|cancelled|failed
    rounds: integer('rounds'), // null = infinite
    style: text('style'),
    includeOrchestrator: boolean('include_orchestrator').notNull().default(false),
    background: boolean('background').notNull().default(false),
    settings: text('settings'), // JSON
    currentRound: integer('current_round').notNull().default(0),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    finishedAt: bigint('finished_at', { mode: 'number' }),
  },
  (t) => [index('idx_wgr_tenant').on(t.tenantId), index('idx_wgr_status').on(t.status)],
);

export const workshopGroupchatAgents = pgTable(
  'workshop_groupchat_agents',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    name: text('name').notNull(),
    systemPrompt: text('system_prompt').notNull(),
    provider: text('provider').notNull(),
    modelId: text('model_id').notNull(),
    orderIndex: integer('order_index').notNull().default(0),
  },
  (t) => [index('idx_wga_run').on(t.runId)],
);

export const workshopGroupchatMessages = pgTable(
  'workshop_groupchat_messages',
  {
    id: text('id').primaryKey(),
    runId: text('run_id').notNull(),
    agentId: text('agent_id'), // null = orchestrator/system turn
    round: integer('round').notNull(),
    role: text('role').notNull(),
    content: text('content').notNull(),
    modelId: text('model_id'),
    latencyMs: integer('latency_ms'),
    tokens: integer('tokens'),
    costUsd: doublePrecision('cost_usd'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (t) => [index('idx_wgm_run').on(t.runId)],
);
