import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { ownerFilter, shouldMaskSensitive } from '$server/services/rbac.service';
import { listContactsCached, listTags } from '$server/services/crm-contacts.service';
import { matchingAutoTagIds } from '$server/services/crm-scoring';
import { contactFinanceMap } from '$server/services/crm-finance.service';

export const load: PageServerLoad = async ({ locals, depends, parent }) => {
  const maybeCtx = await getCoreCtx(locals);
  if (!maybeCtx) throw error(401, 'Authentication required');
  // Narrowed alias — TS control-flow narrowing doesn't reach into the
  // computeRoster closure below.
  const ctx = maybeCtx;
  depends('crm:contacts');
  // Personal orgs de-emphasize the sales funnel (WP2) — the revenue-ranked
  // finance columns (revenue/invoices/lastPurchase) aren't rendered for them,
  // so skip the finance-map query entirely.
  const { activeOrgKind } = await parent();
  const isPersonal = activeOrgKind === 'personal';

  // RBAC gates stay synchronous — an unauthorized/masked request must never
  // fall through to the streamed body below.
  const [ownerId, maskSensitive, tags] = await Promise.all([
    ownerFilter(locals, 'crm'),
    shouldMaskSensitive(locals, 'crm'),
    listTags(ctx),
  ]);

  // The full roster is loaded ONCE (Valkey-cached) and all search/stage/tag/sort
  // filtering happens client-side — instant, no Apply button, no per-keystroke
  // round-trip. Mutations bust the cache tag so the list refreshes. Record-level
  // (if-owner) scope restricts the roster to the caller's own contacts.
  //
  // STREAMED: at 15k+ contacts this payload is >10MB — serializing and
  // shipping it inline blocked every navigation onto this page for seconds.
  // The shell (header, filters, tags) paints immediately; the table hydrates
  // when the roster lands.
  async function computeRoster() {
    const cached = await listContactsCached(ctx, ownerId, maskSensitive);

    // Auto-tags are evaluated LIVE against each scored row (never stored), so the
    // tag filter can match them just like manual tags. Cheap: a few rules × N rows.
    const autoTags = tags.filter((t) => t.kind === 'auto' && t.rule != null);
    const withAutoTags = autoTags.length
      ? cached.map((c) => ({ ...c, auto_tag_ids: matchingAutoTagIds(c, autoTags) }))
      : cached;

    // Finance map is fetched AFTER the cached roster so the Valkey roster cache
    // stays finance-free. Returns {} when either 'crm' or 'finances' module is off,
    // or (WP2) when the org is personal — the revenue-ranked columns never render.
    const financeMap = isPersonal ? {} : await contactFinanceMap(ctx);
    const financeEnabled = Object.keys(financeMap).length > 0;
    const contacts = financeEnabled
      ? withAutoTags.map((c) => ({ ...c, finance: financeMap[c.contact_id] ?? null }))
      : withAutoTags;
    return { contacts, financeEnabled };
  }

  return { tags, orgId: ctx.tenantId, streamed: { roster: computeRoster() } };
};
