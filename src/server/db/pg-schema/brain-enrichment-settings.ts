import { integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type {
  BrainEnrichmentHarness,
  BrainEnrichmentModelProvider,
} from '$lib/brains/enrichment-config';

/** One non-secret enrichment execution target per organization. */
export const brainEnrichmentSettings = pgTable('brain_enrichment_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: text('org_id').notNull().unique(),
  harness: text('harness').$type<BrainEnrichmentHarness>().notNull(),
  adapterId: text('adapter_id'),
  profile: text('profile'),
  distillationModelProvider: text('distillation_model_provider')
    .$type<BrainEnrichmentModelProvider>()
    .notNull(),
  distillationModelId: text('distillation_model_id').notNull(),
  distillationInputUsdPerMillion: numeric('distillation_input_usd_per_million', {
    precision: 12,
    scale: 6,
    mode: 'number',
  }),
  distillationOutputUsdPerMillion: numeric('distillation_output_usd_per_million', {
    precision: 12,
    scale: 6,
    mode: 'number',
  }),
  rerankingModelProvider: text('reranking_model_provider').$type<BrainEnrichmentModelProvider>(),
  rerankingModelId: text('reranking_model_id'),
  rerankingInputUsdPerMillion: numeric('reranking_input_usd_per_million', {
    precision: 12,
    scale: 6,
    mode: 'number',
  }),
  rerankingOutputUsdPerMillion: numeric('reranking_output_usd_per_million', {
    precision: 12,
    scale: 6,
    mode: 'number',
  }),
  dailyTokenBudget: integer('daily_token_budget').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type BrainEnrichmentSettingsRow = typeof brainEnrichmentSettings.$inferSelect;
