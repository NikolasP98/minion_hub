import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { can } from '$lib/access/policy';

export const load: PageServerLoad = async ({ locals }) => {
  if (!can('config.editor', locals.user)) throw error(403, 'Admin access required');
  return {};
};
