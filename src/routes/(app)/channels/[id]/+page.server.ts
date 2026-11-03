import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { loadPluginControlCenter } from '$lib/server/plugin-control-center';

export const load: PageServerLoad = async ({ params, url, locals }) => {
  // Spec 043 R8: the control-center iframe needs the shared gateway token, which orgs without `ai` do not get.
  if (locals.entitlements && !locals.entitlements.features.includes('ai')) error(404, 'Not found');
  return loadPluginControlCenter(params.id, locals, url.origin);
};
