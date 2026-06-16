import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listTags } from '$server/services/crm-contacts.service';
import { getAccountScopeLive } from '$server/services/crm-channels.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('crm:tags');
  depends('crm:accounts');
  // `tags` drives the DEFAULT tab — await it so the page is interactive at once.
  // `scope` needs a live gateway RPC (channels.status) and only feeds the
  // non-default "Channels" tab, so we STREAM it (return the promise unawaited):
  // the page paints immediately and the account manager resolves in the
  // background instead of blocking every settings visit on the gateway. Kept
  // resilient (never rejects) so a slow/down gateway degrades, not errors.
  const tags = await listTags(ctx);
  const scope = getAccountScopeLive(ctx).catch(
    () => ({ added: [], available: [], legacy: true }) as Awaited<ReturnType<typeof getAccountScopeLive>>,
  );
  return { tags, scope };
};
