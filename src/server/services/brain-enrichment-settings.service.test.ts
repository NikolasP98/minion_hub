import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';

vi.mock('./activity.service', () => ({ recordAudit: vi.fn(async () => {}) }));

import { recordAudit } from './activity.service';
import {
  brainEnrichmentSettingsInputSchema,
  getBrainEnrichmentPlatformState,
  getBrainEnrichmentSettingsState,
  listBrainEnrichmentModelCatalog,
  updateBrainEnrichmentConfig,
} from './brain-enrichment-settings.service';
import { brainEnrichmentSettings } from '$server/db/pg-schema/brain-enrichment-settings';

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1', profileId: 'profile-1' });
const actor = { id: 'profile-1', name: 'Admin' };

beforeEach(() => vi.mocked(recordAudit).mockClear());
afterEach(() => vi.unstubAllEnvs());

function baseInput() {
  return {
    harness: 'drone' as const,
    adapterId: null,
    profile: null,
    distillation: { provider: 'harness' as const, modelId: 'small-fast' },
    reranking: null,
    dailyTokenBudget: 250_000,
  };
}

describe('brain enrichment settings validation', () => {
  it('accepts the small harness-managed default', () => {
    expect(brainEnrichmentSettingsInputSchema.parse(baseInput())).toEqual(baseInput());
  });

  it('rejects incompatible harness/provider combinations', () => {
    vi.stubEnv(
      'BRAIN_ENRICHMENT_MODEL_CATALOG',
      JSON.stringify([
        {
          provider: 'openai',
          modelId: 'vendor/small-model',
          label: 'Small model',
          tier: 'small',
          inputUsdPerMillion: 0.2,
          outputUsdPerMillion: 0.8,
        },
      ]),
    );
    expect(() =>
      brainEnrichmentSettingsInputSchema.parse({
        ...baseInput(),
        harness: 'claude-code',
        distillation: { provider: 'openai', modelId: 'vendor/small-model' },
      }),
    ).toThrow(/not supported/);
  });

  it('rejects arbitrary OpenRouter model identifiers outside the server allowlist', () => {
    expect(() =>
      brainEnrichmentSettingsInputSchema.parse({
        ...baseInput(),
        harness: 'pi',
        distillation: { provider: 'openrouter', modelId: 'vendor/unregistered' },
      }),
    ).toThrow(/allowlist/);
  });

  it('requires custom harness adapters to be server registered', () => {
    vi.stubEnv(
      'BRAIN_ENRICHMENT_MODEL_CATALOG',
      JSON.stringify([
        {
          provider: 'openrouter',
          modelId: 'vendor/small-model',
          label: 'Small model',
          tier: 'small',
          inputUsdPerMillion: 0.2,
          outputUsdPerMillion: 0.8,
        },
      ]),
    );
    expect(() =>
      brainEnrichmentSettingsInputSchema.parse({
        ...baseInput(),
        harness: 'custom',
        adapterId: 'unregistered',
        distillation: { provider: 'openrouter', modelId: 'vendor/small-model' },
      }),
    ).toThrow(/server-registered adapter/);
  });

  it('filters catalog entries above the server price ceiling', () => {
    vi.stubEnv(
      'BRAIN_ENRICHMENT_MODEL_CATALOG',
      JSON.stringify([
        {
          provider: 'openrouter',
          modelId: 'vendor/cheap',
          label: 'Cheap',
          tier: 'small',
          inputUsdPerMillion: 0.2,
          outputUsdPerMillion: 0.8,
        },
        {
          provider: 'openrouter',
          modelId: 'vendor/expensive',
          label: 'Expensive',
          tier: 'small',
          inputUsdPerMillion: 2,
          outputUsdPerMillion: 0.8,
        },
      ]),
    );
    expect(listBrainEnrichmentModelCatalog().map((entry) => entry.modelId)).toEqual([
      'small-fast',
      'vendor/cheap',
    ]);
  });

  it('filters entries above the output price ceiling even when input is cheap', () => {
    vi.stubEnv(
      'BRAIN_ENRICHMENT_MODEL_CATALOG',
      JSON.stringify([
        {
          provider: 'openrouter',
          modelId: 'vendor/high-output',
          label: 'High output',
          tier: 'small',
          inputUsdPerMillion: 0.2,
          outputUsdPerMillion: 5,
        },
      ]),
    );
    expect(listBrainEnrichmentModelCatalog().map((entry) => entry.modelId)).toEqual(['small-fast']);
  });

  it('keeps enrichment disabled unless the platform operator explicitly enables it', () => {
    expect(getBrainEnrichmentPlatformState()).toMatchObject({
      enabled: false,
      source: 'default-disabled',
      capabilityStatus: 'not-verified',
      executionReady: false,
    });
    vi.stubEnv('BRAIN_ENRICHMENT_ENABLED', 'true');
    expect(getBrainEnrichmentPlatformState()).toMatchObject({
      enabled: true,
      source: 'environment',
    });
  });
});

describe('brain enrichment settings persistence', () => {
  it('returns a non-writing small/fast default when the org has no row', async () => {
    const { db, resolve } = createMockDb();
    resolve([]);
    await expect(getBrainEnrichmentSettingsState(ctx(db))).resolves.toEqual({
      configured: baseInput(),
      effective: baseInput(),
      status: 'default',
      reasons: [],
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('preserves a removed stored target and reports the safe effective fallback separately', async () => {
    const { db, resolve } = createMockDb();
    resolve([
      {
        id: 'setting-stale',
        orgId: 'org-1',
        harness: 'pi',
        adapterId: null,
        profile: null,
        distillationModelProvider: 'openrouter',
        distillationModelId: 'vendor/removed',
        rerankingModelProvider: null,
        rerankingModelId: null,
        dailyTokenBudget: 250_000,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const state = await getBrainEnrichmentSettingsState(ctx(db));
    expect(state.status).toBe('degraded');
    expect(state.configured.distillation).toEqual({
      provider: 'openrouter',
      modelId: 'vendor/removed',
    });
    expect(state.effective.distillation).toEqual({ provider: 'harness', modelId: 'small-fast' });
    expect(state.reasons.join(' ')).toMatch(/allowlist/);
  });

  it('upserts one org-scoped row and records a non-secret audit summary', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [],
      [
        {
          id: 'setting-1',
          orgId: 'org-1',
          harness: 'codex',
          adapterId: null,
          profile: 'terra',
          distillationModelProvider: 'harness',
          distillationModelId: 'small-fast',
          distillationInputUsdPerMillion: null,
          distillationOutputUsdPerMillion: null,
          rerankingModelProvider: null,
          rerankingModelId: null,
          rerankingInputUsdPerMillion: null,
          rerankingOutputUsdPerMillion: null,
          dailyTokenBudget: 300_000,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    ]);

    const result = await updateBrainEnrichmentConfig(
      ctx(db),
      {
        ...baseInput(),
        harness: 'codex',
        profile: 'terra',
        dailyTokenBudget: 300_000,
      },
      actor,
    );

    expect(result).toMatchObject({
      harness: 'codex',
      distillation: { provider: 'harness', modelId: 'small-fast' },
      profile: 'terra',
      dailyTokenBudget: 300_000,
    });
    expect(db.insert).toHaveBeenCalledWith(brainEnrichmentSettings);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        refType: 'brain_enrichment_settings',
        refId: 'setting-1',
        changes: expect.arrayContaining([
          expect.objectContaining({ field: 'adapter_id' }),
          expect.objectContaining({ field: 'profile' }),
          expect.objectContaining({ field: 'reranking_model' }),
        ]),
      }),
    );
  });
});
