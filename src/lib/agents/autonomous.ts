import { diceBearAvatarUrl } from '$lib/utils/avatar';
import type { CoreCtx } from '$server/auth/core-ctx';

export interface SystemAgentStats {
  sent: number;
  failed: number;
  skipped: number;
}

export interface SystemAgentStatus {
  enabled: boolean;
  state: 'active' | 'disabled' | 'attention';
  stats?: SystemAgentStats;
  detail?: string;
}

/** DB-free description of a system agent — safe to import on the client. */
export interface SystemAgentMeta {
  id: string;
  moduleId: string;
  name: string;
  role: string;
  description: string;
  avatarSeed: string;
  trigger: string;
  managePath: string | null;
  flowId?: string;
  resolveVariables?(ctx: CoreCtx, keys: string[]): Promise<Record<string, unknown>>;
}

export interface AutonomousAgentVM {
  id: string;
  source: 'system' | 'gateway';
  name: string;
  role: string;
  description: string;
  avatarUrl: string;
  trigger: string | null;
  managePath: string | null;
  flowId?: string;
  status: SystemAgentStatus;
}

/**
 * Pure status mapping for the Reminders system agent. Kept here (not in the
 * server registry) so it can be unit-tested without importing DB clients.
 * `detail` is an i18n KEY-FREE marker the registry overrides with a localized
 * string; tests only assert it is truthy.
 */
export function remindersStatus(input: {
  enabled: boolean;
  hasAccount: boolean;
  stats?: SystemAgentStats;
}): SystemAgentStatus {
  if (!input.enabled) return { enabled: false, state: 'disabled', stats: input.stats };
  if (!input.hasAccount) {
    return { enabled: true, state: 'attention', stats: input.stats, detail: 'no-account' };
  }
  return { enabled: true, state: 'active', stats: input.stats };
}

export function systemMetaToVM(meta: SystemAgentMeta, status: SystemAgentStatus): AutonomousAgentVM {
  return {
    id: meta.id,
    source: 'system',
    name: meta.name,
    role: meta.role,
    description: meta.description,
    avatarUrl: diceBearAvatarUrl(meta.avatarSeed),
    trigger: meta.trigger,
    managePath: meta.managePath,
    flowId: meta.flowId,
    status,
  };
}

export function buildSystemAgentVMs(
  metas: SystemAgentMeta[],
  moduleEnabled: (moduleId: string) => boolean,
  statuses: Record<string, SystemAgentStatus>,
): AutonomousAgentVM[] {
  return metas
    .filter((meta) => moduleEnabled(meta.moduleId))
    .map((meta) => systemMetaToVM(meta, statuses[meta.id] ?? { enabled: false, state: 'disabled' }));
}

export function gatewayAgentToVM(
  agent: { id: string; name?: string; emoji?: string; status?: string },
  archetype: string | undefined,
): AutonomousAgentVM | null {
  if (archetype !== 'autonomous') return null;
  const name = agent.name?.trim() || agent.id;
  return {
    id: agent.id,
    source: 'gateway',
    name,
    role: '',
    description: '',
    avatarUrl: diceBearAvatarUrl(name),
    trigger: null,
    managePath: null,
    status: { enabled: true, state: 'active' },
  };
}
