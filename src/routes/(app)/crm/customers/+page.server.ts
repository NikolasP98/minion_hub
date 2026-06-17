import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { listContactsCached, listTags } from '$server/services/crm-contacts.service';
import { matchingAutoTagIds } from '$server/services/crm-scoring';
import { contactFinanceMap } from '$server/services/crm-finance.service';

export const load: PageServerLoad = async ({ locals, depends }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('crm:contacts');

  // The full roster is loaded ONCE (Valkey-cached) and all search/stage/tag/sort
  // filtering happens client-side — instant, no Apply button, no per-keystroke
  // round-trip. Mutations bust the cache tag so the list refreshes.
  const [cached, tags] = await Promise.all([listContactsCached(ctx), listTags(ctx)]);

  // Auto-tags are evaluated LIVE against each scored row (never stored), so the
  // tag filter can match them just like manual tags. Cheap: a few rules × N rows.
  const autoTags = tags.filter((t) => t.kind === 'auto' && t.rule != null);
  const withAutoTags = autoTags.length
    ? cached.map((c) => ({ ...c, auto_tag_ids: matchingAutoTagIds(c, autoTags) }))
    : cached;

  // Finance map is fetched AFTER the cached roster so the Valkey roster cache
  // stays finance-free. Returns {} when either 'crm' or 'finances' module is off.
  const financeMap = await contactFinanceMap(ctx);
  const financeEnabled = Object.keys(financeMap).length > 0;
  const contacts = financeEnabled
    ? withAutoTags.map((c) => ({ ...c, finance: financeMap[c.contact_id] ?? null }))
    : withAutoTags;

  return { contacts, tags, orgId: ctx.tenantId, financeEnabled };
};
