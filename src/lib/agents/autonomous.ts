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
  /** Pre-computed generic health metrics for agents whose activity isn't a flow_run
   *  or reminders-style stats (e.g. the triage kernel). Wins over stats in getHealthMetrics. */
  health?: { lastRunAt: number | null; runs30d: number | null; successRate: number | null };
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
  /** Editable DB flow (flows table) backing this agent, if any. Gates EDIT + drives health metrics. System agents leave this undefined (code/master flows). */
  dbFlowId?: string;
  adminOnly?: boolean;
  resolveVariables?(ctx: CoreCtx, keys: string[]): Promise<Record<string, unknown>>;
}

export interface AutonomousAgentVM {
  id: string;
  source: 'system' | 'gateway' | 'workforce';
  name: string;
  role: string;
  description: string;
  avatarUrl: string;
  trigger: string | null;
  managePath: string | null;
  flowId?: string;
  dbFlowId?: string;
  adminOnly?: boolean;
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
    dbFlowId: meta.dbFlowId,
    adminOnly: meta.adminOnly,
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

/** Minimal shape of a Workforce agent needed to render an autonomous card. */
export interface WorkforceAgentInput {
  id: string;
  name: string;
  role: string;
  title?: string | null;
  status?: string | null;
  capabilities?: string | null;
}

/**
 * Map a Workforce-module agent into an autonomous-agent VM. Every workforce
 * agent is event-driven (acts on issue create/update), so they belong on the
 * autonomous page — segregated as their own module group. Status maps the
 * backend agent state onto the shared active/attention/disabled vocabulary.
 */
export function workforceAgentToVM(agent: WorkforceAgentInput, triggerLabel: string): AutonomousAgentVM {
  const s = (agent.status ?? '').toLowerCase();
  const state: SystemAgentStatus['state'] =
    s === 'error' ? 'attention' : s === 'paused' || s === 'disabled' ? 'disabled' : 'active';
  return {
    id: `workforce:${agent.id}`,
    source: 'workforce',
    name: agent.name,
    role: agent.title || agent.role,
    description: agent.capabilities?.trim() || '',
    avatarUrl: diceBearAvatarUrl(agent.id),
    trigger: triggerLabel,
    managePath: `/workforce/agents/${agent.id}`,
    status: { enabled: state !== 'disabled', state, detail: agent.status ?? undefined },
  };
}
