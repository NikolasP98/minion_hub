import { eq } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import { getCoreDb } from '$server/db/pg-client';
import type { CoreCtx } from '$server/auth/core-ctx';
import { schedReminderConfig } from '$server/db/pg-reminders-schema';
import type { SchedReminderConfig, ReminderStage } from '$server/db/pg-reminders-schema';

export const DEFAULT_STAGES: ReminderStage[] = [
  { key: 'confirmation' },
  { key: '24h', minutesBefore: 1440 },
  { key: '2h', minutesBefore: 120 },
];

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
    channel: 'whatsapp',
    accountId: null,
    personalize: true,
    locale: 'es',
    fromName: null,
    updatedAt: new Date(),
  };
}

export interface ReminderConfigPatch {
  enabled?: boolean;
  stages?: ReminderStage[];
  channel?: string;
  accountId?: string | null;
  personalize?: boolean;
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
        channel: patch.channel ?? 'whatsapp',
        accountId: patch.accountId ?? null,
        personalize: patch.personalize ?? true,
        locale: patch.locale ?? 'es',
        fromName: patch.fromName ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schedReminderConfig.orgId,
        set: {
          ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
          ...(patch.stages !== undefined ? { stages: patch.stages } : {}),
          ...(patch.channel !== undefined ? { channel: patch.channel } : {}),
          ...(patch.accountId !== undefined ? { accountId: patch.accountId } : {}),
          ...(patch.personalize !== undefined ? { personalize: patch.personalize } : {}),
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
