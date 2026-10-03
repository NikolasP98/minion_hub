import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { NOTIFICATION_HEALTH_UNAVAILABLE } from '$lib/notifications/worker-health';
import { requireNotificationRuleManager } from '$server/services/notifications/authority';
import { readNotificationWorkerHealth } from '$server/services/notifications/worker-health';

const headers = {
  'cache-control': 'private, no-store',
  vary: 'Cookie',
};

export const GET: RequestHandler = async ({ locals, url }) => {
  if (url.search !== '') throw error(400, 'Notification health does not accept query parameters.');
  const ctx = await requireNotificationRuleManager(locals);
  try {
    return json(await readNotificationWorkerHealth(ctx.tenantId), { headers });
  } catch {
    return json({ code: NOTIFICATION_HEALTH_UNAVAILABLE }, { status: 503, headers });
  }
};
