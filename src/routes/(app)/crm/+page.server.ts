import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listContactsCached, listTags } from '$server/services/crm-contacts.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('crm:contacts');

  // The full roster is loaded ONCE (Valkey-cached) and all search/stage/tag/sort
  // filtering happens client-side — instant, no Apply button, no per-keystroke
  // round-trip. Mutations bust the cache tag so the list refreshes.
  const [contacts, tags] = await Promise.all([listContactsCached(ctx), listTags(ctx)]);
  return { contacts, tags };
};
