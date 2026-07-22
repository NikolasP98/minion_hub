import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { CoreCtx } from '$server/auth/core-ctx';
import { brainEnrichmentSettings } from '$server/db/pg-schema/brain-enrichment-settings';
import { withOrgCore } from '$server/db/with-org-core';
import {
  BRAIN_ENRICHMENT_DAILY_TOKEN_BUDGET,
  BRAIN_ENRICHMENT_HARNESSES,
  BRAIN_ENRICHMENT_MODEL_PROVIDERS,
  DEFAULT_BRAIN_ENRICHMENT_CONFIG,
  enrichmentModelKey,
  isCompatibleEnrichmentTarget,
  type BrainEnrichmentConfig,
  type BrainEnrichmentHarness,
  type BrainEnrichmentModelProvider,
  type BrainEnrichmentModelTarget,
} from '$lib/brains/enrichment-config';
import { recordAudit } from './activity.service';

type Actor = { id: string | null; name: string | null };

export interface BrainEnrichmentModelCatalogEntry extends BrainEnrichmentModelTarget {
  label: string;
  inputUsdPerMillion: number | null;
  outputUsdPerMillion: number | null;
}

export interface BrainEnrichmentPlatformState {
  enabled: boolean;
  source: 'environment' | 'default-disabled';
  capabilityStatus: 'not-verified';
  executionReady: false;
}

export interface BrainEnrichmentSettingsState {
  configured: BrainEnrichmentConfig;
  /** Safe allowlisted config for a future worker; distinct from runtime readiness. */
  effective: BrainEnrichmentConfig;
  status: 'default' | 'valid' | 'degraded';
  reasons: string[];
}

const BUILTIN_SMALL_MODEL: BrainEnrichmentModelCatalogEntry = {
  provider: 'harness',
  modelId: 'small-fast',
  label: 'Harness-managed small/fast',
  inputUsdPerMillion: null,
  outputUsdPerMillion: null,
};

const MODEL_INPUT_PRICE_CEILING_DEFAULT = 1;
const MODEL_INPUT_PRICE_CEILING_MAX = 5;
const MODEL_OUTPUT_PRICE_CEILING_DEFAULT = 4;
const MODEL_OUTPUT_PRICE_CEILING_MAX = 20;

function modelInputPriceCeiling(): number {
  const raw = process.env.BRAIN_ENRICHMENT_MAX_INPUT_USD_PER_MILLION;
  if (raw === undefined) return MODEL_INPUT_PRICE_CEILING_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, MODEL_INPUT_PRICE_CEILING_MAX);
}

function modelOutputPriceCeiling(): number {
  const raw = process.env.BRAIN_ENRICHMENT_MAX_OUTPUT_USD_PER_MILLION;
  if (raw === undefined) return MODEL_OUTPUT_PRICE_CEILING_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, MODEL_OUTPUT_PRICE_CEILING_MAX);
}

/** Exact opt-in: an absent or malformed kill switch stays disabled. */
export function getBrainEnrichmentPlatformState(): BrainEnrichmentPlatformState {
  const raw = process.env.BRAIN_ENRICHMENT_ENABLED;
  return {
    enabled: raw === 'true',
    source: raw === undefined ? 'default-disabled' : 'environment',
    capabilityStatus: 'not-verified',
    executionReady: false,
  };
}

/**
 * Server allowlist for explicit provider models. Operators register compact
 * targets through BRAIN_ENRICHMENT_MODEL_CATALOG JSON. Entries over the price
 * ceiling or not marked `small` are ignored, so org settings cannot select an
 * arbitrary expensive model id.
 */
export function listBrainEnrichmentModelCatalog(): BrainEnrichmentModelCatalogEntry[] {
  const raw = process.env.BRAIN_ENRICHMENT_MODEL_CATALOG;
  if (!raw) return [{ ...BUILTIN_SMALL_MODEL }];
  try {
    const parsed = z
      .array(
        z.object({
          provider: z.enum(['openrouter', 'anthropic', 'openai']),
          modelId: z.string().trim().min(1).max(200),
          label: z.string().trim().min(1).max(120),
          tier: z.literal('small'),
          inputUsdPerMillion: z.number().nonnegative(),
          outputUsdPerMillion: z.number().nonnegative(),
        }),
      )
      .parse(JSON.parse(raw));
    const inputCeiling = modelInputPriceCeiling();
    const outputCeiling = modelOutputPriceCeiling();
    return [
      { ...BUILTIN_SMALL_MODEL },
      ...parsed
        .filter(
          (entry) =>
            entry.inputUsdPerMillion <= inputCeiling &&
            entry.outputUsdPerMillion <= outputCeiling,
        )
        .map((entry) => ({
          provider: entry.provider,
          modelId: entry.modelId,
          label: entry.label,
          inputUsdPerMillion: entry.inputUsdPerMillion,
          outputUsdPerMillion: entry.outputUsdPerMillion,
        })),
    ];
  } catch {
    // Invalid operator configuration fails closed to the harness-owned compact
    // profile. Never let malformed JSON widen the allowed model set.
    return [{ ...BUILTIN_SMALL_MODEL }];
  }
}

/** Custom adapters are opaque identifiers registered by the server operator. */
export function listBrainEnrichmentAdapterIds(): string[] {
  return [...new Set((process.env.BRAIN_ENRICHMENT_ADAPTER_IDS ?? '').split(','))]
    .map((value) => value.trim())
    .filter((value) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(value))
    .sort();
}

function isAllowedModelTarget(target: BrainEnrichmentModelTarget): boolean {
  return Boolean(findCatalogEntry(target));
}

function findCatalogEntry(
  target: BrainEnrichmentModelTarget,
): BrainEnrichmentModelCatalogEntry | undefined {
  return listBrainEnrichmentModelCatalog().find(
    (entry) => entry.provider === target.provider && entry.modelId === target.modelId,
  );
}

const modelTargetSchema = z.object({
  provider: z.enum(BRAIN_ENRICHMENT_MODEL_PROVIDERS),
  modelId: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/, 'Model identifier contains unsupported characters'),
});

export const brainEnrichmentSettingsInputSchema = z
  .object({
    harness: z.enum(BRAIN_ENRICHMENT_HARNESSES),
    adapterId: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
      .nullable()
      .optional()
      .default(null),
    profile: z
      .string()
      .trim()
      .max(120)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Profile contains unsupported characters')
      .nullable()
      .optional()
      .default(null),
    distillation: modelTargetSchema,
    reranking: modelTargetSchema.nullable().optional().default(null),
    dailyTokenBudget: z
      .number()
      .int()
      .min(BRAIN_ENRICHMENT_DAILY_TOKEN_BUDGET.min)
      .max(BRAIN_ENRICHMENT_DAILY_TOKEN_BUDGET.max),
  })
  .superRefine((value, ctx) => {
    const targets = [
      ['distillation', value.distillation],
      ...(value.reranking ? ([['reranking', value.reranking]] as const) : []),
    ] as const;
    for (const [role, target] of targets) {
      if (!isCompatibleEnrichmentTarget(value.harness, target.provider)) {
        ctx.addIssue({
          code: 'custom',
          path: [role, 'provider'],
          message: `${target.provider} is not supported by the ${value.harness} harness`,
        });
      }
      if (!isAllowedModelTarget(target)) {
        ctx.addIssue({
          code: 'custom',
          path: [role, 'modelId'],
          message: 'Model is not in the server small-model allowlist',
        });
      }
    }
    if (value.harness === 'custom') {
      if (!value.adapterId || !listBrainEnrichmentAdapterIds().includes(value.adapterId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['adapterId'],
          message: 'Custom harness requires a server-registered adapter',
        });
      }
    } else if (value.adapterId !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['adapterId'],
        message: 'Adapter IDs are only valid for the custom harness',
      });
    }
  });

export type BrainEnrichmentSettingsInput = z.infer<typeof brainEnrichmentSettingsInputSchema>;

function validationReasons(config: BrainEnrichmentConfig): string[] {
  const result = brainEnrichmentSettingsInputSchema.safeParse(config);
  if (result.success) return [];
  return result.error.issues.map(
    (issue) => `${issue.path.join('.') || 'settings'}: ${issue.message}`,
  );
}

/**
 * Returns the stored configuration verbatim, plus a separately allowlisted
 * effective fallback. Removed catalog entries therefore remain visible and
 * diagnosable instead of being silently rewritten in the UI.
 */
export async function getBrainEnrichmentSettingsState(
  ctx: CoreCtx,
): Promise<BrainEnrichmentSettingsState> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(brainEnrichmentSettings)
      .where(eq(brainEnrichmentSettings.orgId, ctx.tenantId))
      .limit(1),
  );
  if (!row) {
    const configured = structuredClone(DEFAULT_BRAIN_ENRICHMENT_CONFIG);
    return { configured, effective: structuredClone(configured), status: 'default', reasons: [] };
  }
  const configured: BrainEnrichmentConfig = {
    harness: row.harness,
    adapterId: row.adapterId,
    profile: row.profile,
    distillation: {
      provider: row.distillationModelProvider,
      modelId: row.distillationModelId,
    },
    reranking:
      row.rerankingModelProvider && row.rerankingModelId
        ? { provider: row.rerankingModelProvider, modelId: row.rerankingModelId }
        : null,
    dailyTokenBudget: row.dailyTokenBudget,
  };
  const reasons = validationReasons(configured);
  return {
    configured,
    effective:
      reasons.length === 0
        ? structuredClone(configured)
        : structuredClone(DEFAULT_BRAIN_ENRICHMENT_CONFIG),
    status: reasons.length === 0 ? 'valid' : 'degraded',
    reasons,
  };
}

/** Validated org-scoped upsert consumed by the Settings API and future jobs. */
export async function updateBrainEnrichmentConfig(
  ctx: CoreCtx,
  input: BrainEnrichmentSettingsInput,
  actor: Actor,
): Promise<BrainEnrichmentConfig> {
  const next = brainEnrichmentSettingsInputSchema.parse(input);
  const previousState = await getBrainEnrichmentSettingsState(ctx);
  const previous = previousState.configured;
  const distillationCatalog = findCatalogEntry(next.distillation);
  const rerankingCatalog = next.reranking ? findCatalogEntry(next.reranking) : null;
  // Schema validation above guarantees each selected target is still present.
  if (!distillationCatalog || (next.reranking && !rerankingCatalog)) {
    throw new Error('Selected enrichment model is no longer available');
  }
  const values = {
    orgId: ctx.tenantId,
    harness: next.harness,
    adapterId: next.adapterId,
    profile: next.profile,
    distillationModelProvider: next.distillation.provider,
    distillationModelId: next.distillation.modelId,
    distillationInputUsdPerMillion: distillationCatalog.inputUsdPerMillion,
    distillationOutputUsdPerMillion: distillationCatalog.outputUsdPerMillion,
    rerankingModelProvider: next.reranking?.provider ?? null,
    rerankingModelId: next.reranking?.modelId ?? null,
    rerankingInputUsdPerMillion: rerankingCatalog?.inputUsdPerMillion ?? null,
    rerankingOutputUsdPerMillion: rerankingCatalog?.outputUsdPerMillion ?? null,
    dailyTokenBudget: next.dailyTokenBudget,
  };
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .insert(brainEnrichmentSettings)
      .values(values)
      .onConflictDoUpdate({
        target: brainEnrichmentSettings.orgId,
        set: { ...values, updatedAt: new Date() },
      })
      .returning(),
  );
  await recordAudit(ctx, {
    refType: 'brain_enrichment_settings',
    refId: row.id,
    op: 'update',
    changes: [
      { field: 'harness', label: 'Harness', old: previous.harness, new: row.harness },
      {
        field: 'distillation_model',
        label: 'Distillation model',
        old: enrichmentModelKey(previous.distillation),
        new: enrichmentModelKey(next.distillation),
      },
      {
        field: 'adapter_id',
        label: 'Adapter',
        old: previous.adapterId,
        new: row.adapterId,
      },
      {
        field: 'profile',
        label: 'Harness profile',
        old: previous.profile,
        new: row.profile,
      },
      {
        field: 'reranking_model',
        label: 'Reranking model',
        old: previous.reranking ? enrichmentModelKey(previous.reranking) : null,
        new: next.reranking ? enrichmentModelKey(next.reranking) : null,
      },
      {
        field: 'daily_token_budget',
        label: 'Daily token budget',
        old: previous.dailyTokenBudget,
        new: row.dailyTokenBudget,
      },
    ],
    actor,
  });
  return {
    harness: row.harness,
    adapterId: row.adapterId,
    profile: row.profile,
    distillation: next.distillation,
    reranking: next.reranking,
    dailyTokenBudget: row.dailyTokenBudget,
  };
}
