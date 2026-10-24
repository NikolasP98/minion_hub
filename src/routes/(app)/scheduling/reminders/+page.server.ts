import type { PageServerLoad } from './$types';
import { datasetCtx, isDenied } from '$server/auth/dataset-ctx';
import { getReminderConfig } from '$server/services/reminder-config.service';
import { getReminderActivity } from '$server/services/reminders.service';
import { getChannelCatalog } from '$server/services/crm-channels.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await datasetCtx(locals, 'scheduling');
  if (isDenied(ctx)) return { scheduling: ctx }; // rendered by DataSource (spec 039)
  depends('scheduling:data');
  // Channel accounts are channels data: own handle; denied => no channel choices.
  const chan = await datasetCtx(locals, 'channels');
  const [config, activity, catalog] = await Promise.all([
    getReminderConfig(ctx).catch(() => null),
    getReminderActivity(ctx).catch(() => null),
    isDenied(chan) ? Promise.resolve(null) : getChannelCatalog(chan).catch(() => null),
  ]);
  return { scheduling: { config, activity, channels: catalog?.accounts ?? [] } };
};
