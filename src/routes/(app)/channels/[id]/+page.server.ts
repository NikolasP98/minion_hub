import type { PageServerLoad } from './$types';
import { loadPluginControlCenter } from '$lib/server/plugin-control-center';

export const load: PageServerLoad = ({ params, url, locals }) =>
  loadPluginControlCenter(params.id, locals, url.origin);
