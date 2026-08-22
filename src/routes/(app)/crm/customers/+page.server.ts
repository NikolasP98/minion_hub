import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import { ownerFilter, shouldMaskSensitive } from '$server/services/rbac.service';
import {
  rankContactsPageCached,
  listTags,
  getMetaKeys,
  type RankFilters,
} from '$server/services/crm-contacts.service';
import { matchingAutoTagIds } from '$server/services/crm-scoring';
import { contactFinanceMap } from '$server/services/crm-finance.service';

/** Server-mode page size — mirrored by the page's request manager. */
const PAGE_SIZE = 100;

/**
 * URL → server filters. The page persists its complete filter state in the URL
 * (shareable links, reload-safe), and both this SSR load and the client
 * request manager resolve rows through the same `rankContactsPage` contract as
 * `GET /api/crm/contacts`.
 */
function filtersFromUrl(q: URLSearchParams): RankFilters {
  const csv = (k: string) => q.get(k) || undefined;
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  let minScore = num('scoreMin');
  let maxScore = num('scoreMax');
  // Temperature is a score band (hot ≥75, warm 50–74, cold <50) — fold it into
  // the score range by intersection so temp + explicit range compose.
  const temp = q.get('temp');
  if (temp === 'hot') minScore = Math.max(minScore ?? 75, 75);
  else if (temp === 'warm') {
    minScore = Math.max(minScore ?? 50, 50);
    maxScore = Math.min(maxScore ?? 74, 74);
  } else if (temp === 'cold') maxScore = Math.min(maxScore ?? 49, 49);
  const SORTS = new Set(['score', 'recent', 'frequency', 'name', 'revenue', 'icp']);
  const sort = q.get('sort');
  const pageNum = Math.max(1, num('page') ?? 1);
  return {
    search: q.get('q') || undefined,
    stage: csv('stage'),
    funnelStage: csv('funnel'),
    channel: csv('channel'),
    origin: csv('origin'),
    verified: csv('verified'),
    sex: csv('sex'),
    tagId: q.get('tag') || undefined,
    reservedOnly: q.get('reserved') === '1' || undefined,
    awaitingReply: q.get('awaiting') === '1' || undefined,
    minScore,
    maxScore,
    sort: sort && SORTS.has(sort) ? (sort as RankFilters['sort']) : undefined,
    limit: PAGE_SIZE,
    maxLimit: PAGE_SIZE,
    offset: (pageNum - 1) * PAGE_SIZE,
  };
}

export const load: PageServerLoad = async ({ locals, depends, parent, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401, 'Authentication required');
  depends('crm:contacts');

  // Server-mode page (spec 2026-08-13 §S5): ONE page of rows, never the
  // roster — the old full-roster path shipped a 12MB devalue payload per
  // visit. Every later interaction is a scoped GET /api/crm/contacts.
  const parentP = parent();
  const [ownerId, maskSensitive] = await Promise.all([
    ownerFilter(locals, 'crm'),
    shouldMaskSensitive(locals, 'crm'),
  ]);
  const filters: RankFilters = { ...filtersFromUrl(url.searchParams), ownerId, maskSensitive };

  const [pageRes, tags, metaKeys, financeMap] = await Promise.all([
    rankContactsPageCached(ctx, filters),
    listTags(ctx),
    // Meta columns come from the org-wide distinct-key set, not from scanning
    // shipped rows (the page only has 100 of them now).
    getMetaKeys(ctx),
    // Personal orgs de-emphasize the sales funnel (WP2) — the revenue-ranked
    // finance columns aren't rendered for them, so skip the finance map.
    parentP.then((p) =>
      p.activeOrgKind === 'personal' ? ({} as Record<string, never>) : contactFinanceMap(ctx),
    ),
  ]);

  // Decorate ONLY the returned page — mirrors GET /api/crm/contacts so SSR and
  // client-fetched pages are shape-identical.
  const autoTags = tags.filter((t) => t.kind === 'auto' && t.rule != null);
  const withAutoTags = autoTags.length
    ? pageRes.rows.map((c) => ({ ...c, auto_tag_ids: matchingAutoTagIds(c, autoTags) }))
    : pageRes.rows;
  const financeEnabled = Object.keys(financeMap).length > 0;
  const contacts = financeEnabled
    ? withAutoTags.map((c) => ({ ...c, finance: financeMap[c.contact_id] ?? null }))
    : withAutoTags;

  return {
    contacts,
    total: pageRes.total,
    tags,
    metaKeys,
    orgId: ctx.tenantId,
    financeEnabled,
    pageSize: PAGE_SIZE,
  };
};
