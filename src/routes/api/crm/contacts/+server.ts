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
import { ServerTiming } from '$lib/server/server-timing';
import { sanitizeContactFields } from '$lib/pii';

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
  const timing = new ServerTiming();
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const q = url.searchParams;
  const num = (k: string) => {
    if (!q.has(k)) return undefined;
    const value = Number(q.get(k));
    return Number.isFinite(value) ? value : undefined;
  };
  const bool = (k: string) => (q.get(k) === 'true' || q.get(k) === '1' ? true : undefined);
  const [ownerId, maskSensitive] = await timing.measure('crm_authz', () =>
    Promise.all([ownerFilter(locals, 'crm'), shouldMaskSensitive(locals, 'crm')]),
  );
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
    sortDir: q.get('sortDir') === 'asc' ? 'asc' : q.get('sortDir') === 'desc' ? 'desc' : undefined,
    limit: Math.max(1, Math.min(num('limit') ?? DEFAULT_LIMIT, MAX_LIMIT)),
    maxLimit: MAX_LIMIT,
    offset: Math.max(0, num('offset') ?? 0),
    includeTotal: q.get('includeTotal') !== '0',
    ownerId,
    maskSensitive,
  };

  // Lean id-only variant: same filters, no pagination, no PII, no decoration.
  if (q.get('fields') === 'id') {
    const { rows, total } = await timing.measure('crm_rank', () =>
      rankContactsPageCached(ctx, {
        ...filters,
        limit: ROSTER_CAP,
        maxLimit: ROSTER_CAP,
        offset: 0,
        includeTotal: true,
      }),
    );
    return json(
      { contacts: rows.map((r) => ({ contact_id: r.contact_id })), total },
      { headers: { 'Server-Timing': timing.headerValue() } },
    );
  }

  const [ranked, tags] = await Promise.all([
    timing.measure('crm_rank', () => rankContactsPageCached(ctx, filters)),
    timing.measure('crm_tags', () => listTags(ctx)),
  ]);
  const { rows, total, hasMore, financeEnabled } = ranked;

  // Decorate ONLY the returned page (≤ MAX_LIMIT rows): live auto-tag matches.
  // Finance is already emitted by the ranking query for these rows, avoiding a
  // second full-organization contactFinanceMap scan on every page request.
  const autoTags = tags.filter((t) => t.kind === 'auto' && t.rule != null);
  const withAutoTags = autoTags.length
    ? rows.map((c) => ({ ...c, auto_tag_ids: matchingAutoTagIds(c, autoTags) }))
    : rows;
  return json(
    { contacts: withAutoTags, total, hasMore, financeEnabled },
    { headers: { 'Server-Timing': timing.headerValue() } },
  );
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
  const maskSensitive = await shouldMaskSensitive(locals, 'crm');
  const contact = await createContact(ctx, {
    displayName: typeof body.displayName === 'string' ? body.displayName.trim() : null,
    customFields: body.customFields ?? {},
  });
  return json(
    {
      contact: {
        ...contact,
        customFields: sanitizeContactFields(
          contact.customFields as Record<string, unknown>,
          maskSensitive,
        ),
      },
    },
    { status: 201 },
  );
};
