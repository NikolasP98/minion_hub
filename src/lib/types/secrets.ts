// Local mirror of secrets types/constants from @minion-stack/shared.
// TODO: remove this file once @minion-stack/shared ships a version with `gateway/secrets.ts`
// (>0.5.0). All imports below can then re-target `@minion-stack/shared` with no other changes.

export type SecretsProbeStatus = 'ok' | 'invalid' | 'unknown' | 'missing';
export type SecretsKind = 'static' | 'dynamic';

export interface SecretsSummary {
  rowKey: string;
  groupKey: string;
  instanceId: string | null;
  kind: SecretsKind;
  ownerPlugin: string;
  label: string;
  description?: string;
  probe: string;
  configured: boolean;
  probeStatus: SecretsProbeStatus;
  probeMessage: string | null;
  lastProbeAt: number | null;
  updatedAt: number;
}

export interface SecretsListResult {
  secrets: SecretsSummary[];
}

export interface SecretsSetResult {
  key: string;
  probeStatus: SecretsProbeStatus;
  probeMessage: string;
}

export interface SecretsSetScopedResult {
  groupKey: string;
  instanceId: string;
  probeStatus: SecretsProbeStatus;
  probeMessage: string;
}

export interface SecretsProbeResult {
  key: string;
  probeStatus: SecretsProbeStatus;
  probeMessage: string;
}

export interface SecretsProbeScopedResult {
  groupKey: string;
  instanceId: string;
  probeStatus: SecretsProbeStatus;
  probeMessage: string;
}

export const SECRETS_METHODS = {
  list: 'secrets.list',
  set: 'secrets.set',
  clear: 'secrets.clear',
  probe: 'secrets.probe',
  setScoped: 'secrets.set_scoped',
  clearScoped: 'secrets.clear_scoped',
  probeScoped: 'secrets.probe_scoped',
} as const;
