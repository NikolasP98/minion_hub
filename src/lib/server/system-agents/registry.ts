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
import { triageStatusDetail, type TriageArtifactData } from '$lib/agents/artifacts';

interface SystemAgentDescriptor extends SystemAgentMeta {
  resolveStatus(ctx: CoreCtx): Promise<SystemAgentStatus>;
}

/**
 * Per-request descriptor list. A function (not a const) so paraglide messages
 * resolve in the request's language, mirroring getSections().
 */
function getSystemAgentDescriptors(): SystemAgentDescriptor[] {
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
        ).catch(() => null);
        if (!summary) return { enabled: true, state: 'attention', detail: 'Gateway unreachable' };
        return { enabled: true, state: 'active', detail: triageStatusDetail(summary.counts ?? null) };
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
