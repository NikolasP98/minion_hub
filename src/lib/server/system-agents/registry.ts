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
