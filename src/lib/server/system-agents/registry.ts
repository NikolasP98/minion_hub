import type { CoreCtx } from '$server/auth/core-ctx';
import { listModuleStates } from '$server/services/modules.service';
import { getReminderConfig } from '$server/services/reminder-config.service';
import { getReminderActivity } from '$server/services/reminders.service';
import {
  buildSystemAgentVMs,
  remindersStatus,
  type AutonomousAgentVM,
  type SystemAgentMeta,
  type SystemAgentStatus,
} from '$lib/agents/autonomous';
import * as m from '$lib/paraglide/messages';
import { gatewayCallAsUser } from '$lib/server/gateway-rpc';
import { triageStatusDetail, mapRecentRows, type TriageArtifactData } from '$lib/agents/artifacts';
import { countArtifacts, listRecentArtifacts } from '$lib/server/artifacts/store';

interface SystemAgentDescriptor extends SystemAgentMeta {
  resolveStatus(ctx: CoreCtx): Promise<SystemAgentStatus>;
}

/**
 * Per-request descriptor list. A function (not a const) so paraglide messages
 * resolve in the request's language, mirroring getSections().
 */
export function getSystemAgentDescriptors(): SystemAgentDescriptor[] {
  return [
    {
      id: 'scheduling.reminders',
      moduleId: 'scheduling',
      name: m.sysagent_reminders_name(),
      role: m.sysagent_reminders_role(),
      description: m.sysagent_reminders_desc(),
      avatarSeed: 'minion-reminders-agent',
      trigger: m.sysagent_reminders_trigger(),
      managePath: '/scheduling/reminders',
      flowId: 'agent-reminders',
      async resolveStatus(ctx) {
        const [config, activity] = await Promise.all([
          getReminderConfig(ctx).catch(() => null),
          getReminderActivity(ctx).catch(() => null),
        ]);
        const status = remindersStatus({
          enabled: !!config?.enabled,
          hasAccount: !!config?.accountId,
          stats: activity?.counts,
        });
        // Localize the attention detail marker emitted by the pure helper.
        if (status.detail === 'no-account') status.detail = m.sysagent_status_no_account();
        return status;
      },
      async resolveVariables(ctx, keys) {
        const act = await getReminderActivity(ctx).catch(() => null);
        const result: Record<string, unknown> = {};
        if (keys.includes('reminders.sent')) result['reminders.sent'] = act?.counts.sent ?? 0;
        if (keys.includes('reminders.failed')) result['reminders.failed'] = act?.counts.failed ?? 0;
        if (keys.includes('reminders.skipped'))
          result['reminders.skipped'] = act?.counts.skipped ?? 0;
        return result;
      },
    },
    {
      id: 'alert-watcher',
      moduleId: 'triage',
      name: m.sysagent_triage_name(),
      role: m.sysagent_triage_role(),
      description: m.sysagent_triage_desc(),
      avatarSeed: 'minion-alert-watcher',
      trigger: m.sysagent_triage_trigger(),
      managePath: null,
      flowId: 'agent-alert-watcher',
      async resolveStatus(ctx) {
        const summary = await gatewayCallAsUser<{ counts?: TriageArtifactData['counts'] }>(
          'plugins.alerts.summary',
          { since: Date.now() - 30 * 24 * 60 * 60 * 1000 },
          ctx.profileId,
          { orgId: ctx.tenantId },
        ).catch(() => null);
        if (!summary)
          return { enabled: true, state: 'attention', detail: m.sysagent_triage_unreachable() };
        const c = summary.counts ?? null;
        const total = c?.total ?? 0;
        return {
          enabled: true,
          state: 'active',
          detail: triageStatusDetail(c, {
            unavailable: m.artifact_triage_status_unavailable(),
            none: m.artifact_triage_status_none(),
            count: (t, high) => m.artifact_triage_status_count({ total: t, high }),
          }),
          // Triage is a continuous kernel (no discrete flow_runs): surface alert
          // volume + notify rate as the generic health metrics. lastRunAt N/A.
          health: {
            lastRunAt: null,
            runs30d: c ? total : null,
            successRate: total > 0 ? c!.notified / total : null,
          },
        };
      },
      async resolveVariables(ctx, keys) {
        const result: Record<string, unknown> = {};
        if (keys.includes('triage.counts.total') || keys.includes('triage.counts.high')) {
          const summary = await gatewayCallAsUser<{ counts?: { total?: number; high?: number } }>(
            'plugins.alerts.summary',
            { since: Date.now() - 30 * 24 * 60 * 60 * 1000 },
            ctx.profileId,
            { orgId: ctx.tenantId },
          ).catch(() => null);
          if (keys.includes('triage.counts.total'))
            result['triage.counts.total'] = summary?.counts?.total ?? 0;
          if (keys.includes('triage.counts.high'))
            result['triage.counts.high'] = summary?.counts?.high ?? 0;
        }
        if (keys.includes('triage.recent')) {
          const recent = await gatewayCallAsUser<{ rows?: Array<Record<string, unknown>> }>(
            'plugins.alerts.recent',
            { limit: 10 },
            ctx.profileId,
            { orgId: ctx.tenantId },
          ).catch(() => null);
          result['triage.recent'] = mapRecentRows(recent?.rows ?? []);
        }
        return result;
      },
    },
    {
      id: 'artifact-builder',
      moduleId: 'artifacts',
      adminOnly: true,
      name: m.sysagent_builder_name(),
      role: m.sysagent_builder_role(),
      description: m.sysagent_builder_desc(),
      avatarSeed: 'minion-artifact-builder',
      trigger: m.sysagent_builder_trigger(),
      managePath: null,
      flowId: 'agent-artifact-builder',
      async resolveStatus(ctx) {
        const n = await countArtifacts(ctx).catch(() => null);
        if (n === null) return { enabled: true, state: 'attention', detail: 'Unavailable' };
        return { enabled: true, state: 'active', detail: m.sysagent_builder_status({ n }) };
      },
      async resolveVariables(ctx, keys) {
        const out: Record<string, unknown> = {};
        if (keys.includes('artifacts.builtCount'))
          out['artifacts.builtCount'] = await countArtifacts(ctx).catch(() => 0);
        if (keys.includes('artifacts.recent'))
          out['artifacts.recent'] = await listRecentArtifacts(ctx).catch(() => []);
        return out;
      },
    },
  ];
}

/** Resolve all visible system agents for an org into view-models. */
export async function loadSystemAgentVMs(ctx: CoreCtx): Promise<AutonomousAgentVM[]> {
  const descriptors = getSystemAgentDescriptors();
  const moduleStates = await listModuleStates(ctx).catch(() => ({}) as Record<string, boolean>);
  const statuses: Record<string, SystemAgentStatus> = {};
  await Promise.all(
    descriptors.map(async (d) => {
      statuses[d.id] = await d
        .resolveStatus(ctx)
        .catch(() => ({ enabled: false, state: 'disabled' as const }));
    }),
  );
  const metas: SystemAgentMeta[] = descriptors.map(({ resolveStatus: _omit, ...meta }) => meta);
  return buildSystemAgentVMs(metas, (mid) => moduleStates[mid] ?? true, statuses);
}
