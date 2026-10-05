import type { PageServerLoad } from './$types';
import type { NotificationHealthSeed } from '$lib/notifications/worker-health';
import { requireNotificationRuleManager } from '$server/services/notifications/authority';
import { readNotificationWorkerHealth } from '$server/services/notifications/worker-health';
import { listRules, NOTIF_TABLES } from '$server/services/notif.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await requireNotificationRuleManager(locals);
  depends('settings:notifications');
  const [rules, healthSeed] = await Promise.all([
    listRules(ctx),
    readNotificationWorkerHealth(ctx.tenantId)
      .then((value): NotificationHealthSeed => ({
        actorId: ctx.profileId,
        orgId: ctx.tenantId,
        status: 'ready',
        value,
      }))
      .catch((): NotificationHealthSeed => ({
        actorId: ctx.profileId,
        orgId: ctx.tenantId,
        status: 'unavailable',
      })),
  ]);
  return { rules, tables: NOTIF_TABLES, healthSeed };
};
