/**
 * Public, non-secret contract for Brain corpus enrichment. Provider
 * credentials and process-launch configuration are deliberately absent.
 */
export const BRAIN_ENRICHMENT_HARNESSES = [
  'drone',
  'claude-code',
  'codex',
  'pi',
  'custom',
] as const;
export type BrainEnrichmentHarness = (typeof BRAIN_ENRICHMENT_HARNESSES)[number];

export const BRAIN_ENRICHMENT_MODEL_PROVIDERS = [
  'harness',
  'openrouter',
  'anthropic',
  'openai',
] as const;
export type BrainEnrichmentModelProvider = (typeof BRAIN_ENRICHMENT_MODEL_PROVIDERS)[number];

export const BRAIN_ENRICHMENT_PROVIDER_MATRIX: Readonly<
  Record<BrainEnrichmentHarness, readonly BrainEnrichmentModelProvider[]>
> = {
  drone: ['harness', 'openrouter'],
  'claude-code': ['harness', 'anthropic'],
  codex: ['harness', 'openai', 'openrouter'],
  pi: ['harness', 'openrouter'],
  custom: ['openrouter'],
};

export interface BrainEnrichmentModelTarget {
  provider: BrainEnrichmentModelProvider;
  modelId: string;
}

export interface BrainEnrichmentConfig {
  harness: BrainEnrichmentHarness;
  /** Server-registered adapter id. Required only for the custom harness. */
  adapterId: string | null;
  /** Optional non-secret harness profile name. */
  profile: string | null;
  distillation: BrainEnrichmentModelTarget;
  /** Optional second small model for post-retrieval reranking. */
  reranking: BrainEnrichmentModelTarget | null;
  dailyTokenBudget: number;
}

export const BRAIN_ENRICHMENT_DAILY_TOKEN_BUDGET = Object.freeze({
  min: 10_000,
  max: 5_000_000,
  default: 250_000,
});

export const DEFAULT_BRAIN_ENRICHMENT_CONFIG: Readonly<BrainEnrichmentConfig> = {
  harness: 'drone',
  adapterId: null,
  profile: null,
  distillation: { provider: 'harness', modelId: 'small-fast' },
  reranking: null,
  dailyTokenBudget: BRAIN_ENRICHMENT_DAILY_TOKEN_BUDGET.default,
};

export function providersForHarness(
  harness: BrainEnrichmentHarness,
): readonly BrainEnrichmentModelProvider[] {
  return BRAIN_ENRICHMENT_PROVIDER_MATRIX[harness];
}

export function isCompatibleEnrichmentTarget(
  harness: BrainEnrichmentHarness,
  provider: BrainEnrichmentModelProvider,
): boolean {
  return providersForHarness(harness).includes(provider);
}

export function enrichmentModelKey(target: BrainEnrichmentModelTarget): string {
  return `${target.provider}:${target.modelId}`;
}
