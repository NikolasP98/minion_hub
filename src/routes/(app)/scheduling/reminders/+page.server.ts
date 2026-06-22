import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getCoreCtx } from '$server/auth/core-ctx';
import { isModuleEnabled } from '$server/services/modules.service';
import { getReminderConfig } from '$server/services/reminder-config.service';
import { getReminderActivity } from '$server/services/reminders.service';
import { getChannelCatalog } from '$server/services/crm-channels.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  if (!(await isModuleEnabled(ctx, 'scheduling'))) throw error(404, 'Scheduling module disabled');
  depends('scheduling:data');
  const [config, activity, catalog] = await Promise.all([
    getReminderConfig(ctx).catch(() => null),
    getReminderActivity(ctx).catch(() => null),
    getChannelCatalog(ctx).catch(() => null),
  ]);
  return { config, activity, channels: catalog?.accounts ?? [] };
};
