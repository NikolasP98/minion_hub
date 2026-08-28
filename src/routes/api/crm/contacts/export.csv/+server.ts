import type { RequestHandler } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { getCoreCtx } from '$server/auth/core-ctx';
import {
  ownerFilter,
  requireOrgCapability,
  shouldMaskSensitive,
} from '$server/services/rbac.service';
import {
  getMetaKeys,
  rankContactsPageCached,
  ROSTER_CAP,
  type RankFilters,
  type RankedContact,
} from '$server/services/crm-contacts.service';
import { toCsv } from '$lib/export/table-export';

const FIXED_COLUMNS = new Set([
  'name',
  'score',
  'stage',
  'funnel',
  'verified',
  'sex',
  'origin',
  'revenue',
  'invoices',
  'lastPurchase',
  'channels',
  'msgs',
  'inbound',
  'outbound',
  'recent',
]);

const HEADERS: Record<string, string> = {
  name: 'Contact',
  score: 'Score',
  stage: 'Stage',
  funnel: 'Funnel',
  verified: 'Verified',
  sex: 'Sex',
  origin: 'Origin',
  revenue: 'Revenue',
  invoices: 'Invoices',
  lastPurchase: 'Last purchase',
  channels: 'Channels',
  msgs: 'Messages',
  inbound: 'Inbound',
  outbound: 'Outbound',
  recent: 'Last contact',
};

function num(q: URLSearchParams, key: string): number | undefined {
  if (!q.has(key)) return undefined;
  const value = Number(q.get(key));
  return Number.isFinite(value) ? value : undefined;
}

function bool(q: URLSearchParams, key: string): true | undefined {
  return q.get(key) === 'true' || q.get(key) === '1' ? true : undefined;
}

function valueOf(row: RankedContact, key: string): string | number {
  if (key.startsWith('meta:')) {
    const value = row.custom_fields[key.slice(5)];
    return value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  switch (key) {
    case 'name':
      return row.display_name ?? '';
    case 'score':
      return row.score;
    case 'stage':
      return row.stage;
    case 'funnel':
      return row.funnel_stage ?? '';
    case 'verified':
      return row.dni_verified ? 'yes' : 'no';
    case 'sex':
      return row.sex ?? '';
    case 'origin':
      return row.lead_origin ?? '';
    case 'revenue':
      return row.finance?.revenue ?? '';
    case 'invoices':
      return row.finance?.invoices ?? '';
    case 'lastPurchase':
      return row.finance?.lastPurchaseAt ?? '';
    case 'channels':
      return row.channels.join(', ');
    case 'msgs':
      return row.total_msgs;
    case 'inbound':
      return row.inbound_msgs;
    case 'outbound':
      return row.total_msgs - row.inbound_msgs;
    case 'recent':
      return row.last_contact_at ?? '';
    default:
      return '';
  }
}

/** Complete filtered CSV export for the supported CRM roster bound. */
export const GET: RequestHandler = async ({ locals, url }) => {
  await requireOrgCapability(locals, 'crm', 'export');
  const ctx = await getCoreCtx(locals);
  if (!ctx) throw error(401);
  const q = url.searchParams;
  const [ownerId, maskSensitive, metaKeys] = await Promise.all([
    ownerFilter(locals, 'crm'),
    shouldMaskSensitive(locals, 'crm'),
    getMetaKeys(ctx),
  ]);
  const allowed = new Set([...FIXED_COLUMNS, ...metaKeys.map((key) => `meta:${key}`)]);
  const requested = (q.get('columns') ?? 'name,score,stage,channels,recent')
    .split(',')
    .filter((key) => allowed.has(key));
  if (requested.length === 0) throw error(400, 'No exportable columns selected');

  const filters: RankFilters = {
    stage: q.get('stage') ?? undefined,
    channel: q.get('channel') ?? undefined,
    tagId: q.get('tagId') ?? undefined,
    search: q.get('search') ?? undefined,
    minScore: num(q, 'minScore'),
    maxScore: num(q, 'maxScore'),
    awaitingReply: bool(q, 'awaitingReply'),
    buyerOnly: bool(q, 'buyerOnly'),
    reservedOnly: bool(q, 'reservedOnly'),
    funnelStage: q.get('funnelStage') ?? undefined,
    origin: q.get('origin') ?? undefined,
    verified: q.get('verified') ?? undefined,
    sex: q.get('sex') ?? undefined,
    minIcp: num(q, 'minIcp'),
    maxIcp: num(q, 'maxIcp'),
    sort: (q.get('sort') as RankFilters['sort']) ?? undefined,
    sortDir: q.get('sortDir') === 'asc' ? 'asc' : q.get('sortDir') === 'desc' ? 'desc' : undefined,
    ownerId,
    maskSensitive,
    limit: ROSTER_CAP,
    maxLimit: ROSTER_CAP,
    offset: 0,
    includeTotal: true,
  };
  const page = await rankContactsPageCached(ctx, filters);
  if ((page.total ?? 0) > page.rows.length) {
    throw error(413, `Export exceeds the ${ROSTER_CAP.toLocaleString()} row safety limit`);
  }

  const header = requested.map((key) => (key.startsWith('meta:') ? key.slice(5) : HEADERS[key]));
  const encoder = new TextEncoder();
  let cursor = -1;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (cursor === -1) {
        controller.enqueue(encoder.encode('\uFEFF' + toCsv([header]) + '\r\n'));
        cursor = 0;
        return;
      }
      const row = page.rows[cursor++];
      if (row)
        controller.enqueue(
          encoder.encode(toCsv([requested.map((key) => valueOf(row, key))]) + '\r\n'),
        );
      else controller.close();
    },
  });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="customers-${stamp}.csv"`,
      'cache-control': 'private, no-store',
    },
  });
};
