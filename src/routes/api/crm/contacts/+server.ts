import type { RequestHandler } from '@sveltejs/kit';
import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { getCoreCtx } from '$server/auth/core-ctx';
import { parseBody } from '$server/api/validate';
import { ownerFilter, shouldMaskSensitive } from '$server/services/rbac.service';
import {
  rankContactsPageCached,
  createContact,
  listTags,
  ROSTER_CAP,
  type RankFilters,
} from '$server/services/crm-contacts.service';
import { matchingAutoTagIds } from '$server/services/crm-scoring';
import { contactFinanceMap } from '$server/services/crm-finance.service';

/** Page-size caps (spec 2026-08-13 §S3): default 100 rows, hard max 500. */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * GET /api/crm/contacts — ranked, filterable contact list (the core product).
 *
 * Server-mode page contract: `{ contacts, total }` where `total` is the row
 * count the SAME filters match with limit/offset removed. `contacts` keeps its
 * name and element shape — decoration (`finance`, `auto_tag_ids`) is ADDITIVE
 * and computed over the returned page only, never the full roster.
 *
 * `?fields=id` returns a lean id-only variant for the current filters (feeds
 * "select all N matching"), capped at ROSTER_CAP.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const q = url.searchParams;
  const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
  const bool = (k: string) => (q.get(k) === 'true' || q.get(k) === '1' ? true : undefined);
  const filters: RankFilters = {
    stage: q.get('stage') ?? undefined,
    channel: q.get('channel') ?? undefined,
    tagId: q.get('tagId') ?? undefined,
    search: q.get('search') ?? undefined,
    minScore: num('minScore'),
    maxScore: num('maxScore'),
    // S2 filters, parsed here (S3) so a page of rows is sufficient.
    awaitingReply: bool('awaitingReply'),
    buyerOnly: bool('buyerOnly'),
    reservedOnly: bool('reservedOnly'),
    funnelStage: q.get('funnelStage') ?? undefined,
    origin: q.get('origin') ?? undefined,
    verified: q.get('verified') ?? undefined,
    sex: q.get('sex') ?? undefined,
    minIcp: num('minIcp'),
    maxIcp: num('maxIcp'),
    sort: (q.get('sort') as RankFilters['sort']) ?? undefined,
    limit: Math.min(num('limit') ?? DEFAULT_LIMIT, MAX_LIMIT),
    maxLimit: MAX_LIMIT,
    offset: num('offset'),
    ownerId: await ownerFilter(locals, 'crm'),
    maskSensitive: await shouldMaskSensitive(locals, 'crm'),
  };

  // Lean id-only variant: same filters, no pagination, no PII, no decoration.
  if (q.get('fields') === 'id') {
    const { rows, total } = await rankContactsPageCached(ctx, {
      ...filters,
      limit: ROSTER_CAP,
      maxLimit: ROSTER_CAP,
      offset: 0,
    });
    return json({ contacts: rows.map((r) => ({ contact_id: r.contact_id })), total });
  }

  const { rows, total } = await rankContactsPageCached(ctx, filters);

  // Decorate ONLY the returned page (≤ MAX_LIMIT rows): live auto-tag matches
  // and the cached finance rollup. Both were full-roster passes in the page
  // load before pagination.
  const tags = await listTags(ctx);
  const autoTags = tags.filter((t) => t.kind === 'auto' && t.rule != null);
  const withAutoTags = autoTags.length
    ? rows.map((c) => ({ ...c, auto_tag_ids: matchingAutoTagIds(c, autoTags) }))
    : rows;
  const financeMap = await contactFinanceMap(ctx);
  const contacts = Object.keys(financeMap).length
    ? withAutoTags.map((c) => ({ ...c, finance: financeMap[c.contact_id] ?? null }))
    : withAutoTags;

  return json({ contacts, total });
};

const postSchema = z.object({
  displayName: z.string().max(500).nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

/** POST /api/crm/contacts — manually create a contact. */
export const POST: RequestHandler = async ({ locals, request }) => {
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const body = await parseBody(request, postSchema);
  const contact = await createContact(ctx, {
    displayName: typeof body.displayName === 'string' ? body.displayName.trim() : null,
    customFields: body.customFields ?? {},
  });
  return json({ contact }, { status: 201 });
};
