import { eq } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { getCoreDb } from '$server/db/pg-client';
import type { CoreCtx } from '$server/auth/core-ctx';
import { schedReminderConfig } from '$server/db/pg-reminders-schema';
import type { SchedReminderConfig, ReminderStage, ReminderChannel } from '$server/db/pg-reminders-schema';

export const DEFAULT_STAGES: ReminderStage[] = [
  { key: 'confirmation', recipients: 'client' },
  { key: '24h', minutesBefore: 1440, recipients: 'client' },
  { key: '2h', minutesBefore: 120, recipients: 'client' },
];

/** The channels to send on: the `channels` array, or the legacy single
 *  channel/account pair when it's empty (back-compat for pre-rework configs). */
export function effectiveChannels(config: Pick<SchedReminderConfig, 'channels' | 'channel' | 'accountId'>): ReminderChannel[] {
  const list = (config.channels as ReminderChannel[] | null) ?? [];
  if (list.length) return list.filter((c) => c && c.channel);
  if (config.accountId || config.channel) return [{ channel: config.channel || 'whatsapp', accountId: config.accountId ?? null }];
  return [];
}

/** Read the org's reminder config, or a default-off shape when absent. */
export async function getReminderConfig(ctx: CoreCtx): Promise<SchedReminderConfig> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx.select().from(schedReminderConfig).where(eq(schedReminderConfig.orgId, ctx.tenantId)).limit(1),
  );
  if (rows[0]) return rows[0];
  return {
    orgId: ctx.tenantId,
    enabled: false,
    stages: DEFAULT_STAGES,
    channels: [],
    channel: 'whatsapp',
    accountId: null,
    personalize: true,
    inferConfirmation: false,
    locale: 'es',
    fromName: null,
    updatedAt: new Date(),
  };
}

export interface ReminderConfigPatch {
  enabled?: boolean;
  stages?: ReminderStage[];
  channels?: ReminderChannel[];
  channel?: string;
  accountId?: string | null;
  personalize?: boolean;
  inferConfirmation?: boolean;
  locale?: string;
  fromName?: string | null;
}

export async function saveReminderConfig(ctx: CoreCtx, patch: ReminderConfigPatch): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx
      .insert(schedReminderConfig)
      .values({
        orgId: ctx.tenantId,
        enabled: patch.enabled ?? false,
        stages: patch.stages ?? DEFAULT_STAGES,
        channels: patch.channels ?? [],
        channel: patch.channel ?? 'whatsapp',
        accountId: patch.accountId ?? null,
        personalize: patch.personalize ?? true,
        inferConfirmation: patch.inferConfirmation ?? false,
        locale: patch.locale ?? 'es',
        fromName: patch.fromName ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schedReminderConfig.orgId,
        set: {
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.stages !== undefined ? { stages: patch.stages } : {}),
          ...(patch.channels !== undefined ? { channels: patch.channels } : {}),
          ...(patch.channel !== undefined ? { channel: patch.channel } : {}),
          ...(patch.accountId !== undefined ? { accountId: patch.accountId } : {}),
          ...(patch.personalize !== undefined ? { personalize: patch.personalize } : {}),
          ...(patch.inferConfirmation !== undefined ? { inferConfirmation: patch.inferConfirmation } : {}),
          ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
          ...(patch.fromName !== undefined ? { fromName: patch.fromName } : {}),
          updatedAt: new Date(),
        },
      }),
  );
}

/** Org ids with reminders enabled — bypass-RLS read for the system-wide cron tick. */
export async function listEnabledReminderOrgs(): Promise<string[]> {
  const rows = await getCoreDb()
    .select({ orgId: schedReminderConfig.orgId })
    .from(schedReminderConfig)
    .where(eq(schedReminderConfig.enabled, true));
  return rows.map((r) => r.orgId);
}
