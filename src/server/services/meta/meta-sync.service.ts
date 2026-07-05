/**
 * Meta sync dispatcher (spec §6, 2026-07-04-meta-business-integration, WP5).
 * `runJob` claims one job and advances it by one bounded slice: posts/ig-media
 * insights, ad-account daily insights, or page conversations → the shared
 * `messages` ledger. Each slice is capped by an ITEM count (not a time budget
 * — spec §6 calls out "~40 posts / 90 ad-days per claim"), which keeps a
 * single serverless invocation short without needing wall-clock bookkeeping.
 * Resume state across slices is a small JSON blob in `meta_sync_jobs
 * .page_cursor`: `{ i, next? }` — `i` indexes into a deterministic
 * (sorted-by-external-id) target list, `next` is Graph's own pagination
 * cursor for whichever target was mid-page when the slice ended.
 *
 * Connections/assets are read via meta-connections.service.ts (WP4) — this
 * file only WRITES meta_post_insights / meta_ad_insights / messages and the
 * job row itself, and reuses WP2's graph-read.ts client as-is.
 */
import { and, eq, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { withOrgCore } from '$server/db/with-org-core';
import { getCoreDb } from '$server/db/pg-client';
import type { CoreCtx } from '$server/auth/core-ctx';
import { decrypt } from '$server/auth/crypto';
import {
  metaConnections,
  metaPostInsights,
  metaAdInsights,
  type MetaAsset,
  type MetaSyncJob,
} from '$server/db/pg-meta-schema';
import { listConnections, listAssets } from './meta-connections.service';
import {
  listPagePosts,
  postInsights,
  listIgMedia,
  igMediaInsights,
  adInsights,
  listAdStoryIds,
  listConversations,
  fetchNextPage,
  type PagePost,
  type IgMedia,
  type MetricInsight,
  type AdInsightRow,
  type Conversation,
} from './graph-read';
import { insertMessages, type IngestRow } from '../messages.service';
import { claimJob, finishJob, getJobById, recordProgress, requeue } from './meta-sync-jobs.service';

/**
 * Shared Graph opts carrying the App Secret so every authenticated read sends
 * `appsecret_proof` (the app enforces "Require app secret proof for server API
 * calls" — without it Graph rejects with code 100 and no data is returned).
 * fetchNextPage() also gets it: SOME `paging.next` links echo the original
 * appsecret_proof, but /insights links do not (live-verified code-100 on page 2
 * of a chunked ad-insights pull) — fetchNextPage re-derives it when needed.
 */
const graphAuthOpts = () => ({ appSecret: env.META_APP_SECRET });

// Each post now costs ~0 extra Graph calls beyond pagination (see the
// insights-denial memoization in syncPosts), so a slice can carry far more
// than the old per-post-insight-call budget of 40.
const MAX_POSTS_PER_SLICE = 150;
const MAX_AD_ROWS_PER_SLICE = 90;
const MAX_CONVERSATIONS_PER_SLICE = 100;
const BACKFILL_DAYS = 90;

export function defaultSinceDate(days = BACKFILL_DAYS, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

export function computeAdsUntil(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Full-history "Sync now" windows (POST /api/meta/sync/run?full=1)
// ---------------------------------------------------------------------------

export type SyncKind = 'posts' | 'ads' | 'messages';

/** Facebook's founding year — Graph accepts an arbitrarily old `since`, so this is effectively "everything". */
export const FULL_HISTORY_SINCE = '2004-01-01';

/** Meta's ad-insights lookback cap is documented as ~37 months; clamp to 36 to stay safely inside it. */
const AD_INSIGHTS_LOOKBACK_MONTHS = 36;

export function fullAdsHistorySince(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - AD_INSIGHTS_LOOKBACK_MONTHS);
  return d.toISOString().slice(0, 10);
}

/** Since-window for a "Sync now" enqueue. Non-full: unchanged 90-day default for every kind. */
export function resolveSyncSince(kind: SyncKind, full: boolean, now: Date = new Date()): string {
  if (!full) return defaultSinceDate(undefined, now);
  return kind === 'ads' ? fullAdsHistorySince(now) : FULL_HISTORY_SINCE;
}

/**
 * Ads restatement window (spec §6): re-pull the last 2 days for attribution
 * settling, but never go further back than the 90-day backfill floor.
 * Pure — unit-tested directly.
 */
export function computeAdsSince(lastSyncedDate: string | null, now: Date = new Date()): string {
  const floor = now.getTime() - BACKFILL_DAYS * 86_400_000;
  if (!lastSyncedDate) return new Date(floor).toISOString().slice(0, 10);
  const restated = Date.parse(`${lastSyncedDate}T00:00:00Z`) - 2 * 86_400_000;
  return new Date(Math.max(restated, floor)).toISOString().slice(0, 10);
}

/** `cs` = the ads sync's current time-window since-date (chunked pulls only). */
type Resume = { i: number; next?: string; cs?: string };
function parseResume(pageCursor: string | null): Resume {
  if (!pageCursor) return { i: 0 };
  try {
    const p = JSON.parse(pageCursor) as Partial<Resume>;
    return typeof p.i === 'number' ? { i: p.i, next: p.next, cs: p.cs } : { i: 0 };
  } catch {
    return { i: 0 };
  }
}

/**
 * Split [since, until] into consecutive ≤chunkDays windows (inclusive dates).
 * Meta rejects daily×ad-level insights over long ranges with "Please reduce
 * the amount of data you're asking for" (code 1) — pull quarter-sized windows.
 */
export function adTimeWindows(since: string, until: string, chunkDays = 90): Array<{ since: string; until: string }> {
  const DAY = 86_400_000;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const end = Date.parse(`${until}T00:00:00Z`);
  let s = Date.parse(`${since}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(end) || s > end) return [{ since, until }];
  const out: Array<{ since: string; until: string }> = [];
  while (s <= end) {
    const e = Math.min(s + (chunkDays - 1) * DAY, end);
    out.push({ since: iso(s), until: iso(e) });
    s = e + DAY;
  }
  return out;
}
const serializeResume = (r: Resume): string => JSON.stringify(r);

function decryptOrNull(ciphertext: string | null | undefined, iv: string | null | undefined): string | null {
  if (!ciphertext || !iv) return null;
  try {
    return decrypt(ciphertext, iv);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pure mapping: Graph conversation message → messages-ledger IngestRow
// ---------------------------------------------------------------------------

function extractId(v: unknown): string | null {
  if (v && typeof v === 'object' && 'id' in v) {
    const id = (v as { id?: unknown }).id;
    return typeof id === 'string' ? id : null;
  }
  return null;
}

function extractName(v: unknown): string | null {
  if (v && typeof v === 'object' && 'name' in v) {
    const name = (v as { name?: unknown }).name;
    return typeof name === 'string' ? name : null;
  }
  return null;
}

function extractParticipantIds(participants: unknown): string[] {
  const data = (participants as { data?: unknown[] } | undefined)?.data;
  if (!Array.isArray(data)) return [];
  return data.map(extractId).filter((id): id is string => id != null);
}

/** id → name for every participant, so an inbound message's customer id can
 *  resolve to a display name (Graph's per-message `from` also carries a name,
 *  used as a fallback when a participant is missing from the list). */
function extractParticipantNames(participants: unknown): Map<string, string> {
  const data = (participants as { data?: unknown[] } | undefined)?.data;
  const map = new Map<string, string>();
  if (!Array.isArray(data)) return map;
  for (const p of data) {
    const id = extractId(p);
    const name = extractName(p);
    if (id && name) map.set(id, name);
  }
  return map;
}

type ConvoMessage = NonNullable<Conversation['messages']>['data'] extends Array<infer M> | undefined ? M : never;

/**
 * `chatId` is always the customer's participant id (both directions — matches
 * crm-send.service.ts's `buildOutboundRow` and the harvest anti-join in
 * crm-contacts.service.ts, which key `crm_contact_identities.external_id` off
 * inbound `sender_id` and expect `chat_id` to agree). `senderId` is whoever
 * authored THIS message (customer for inbound, the page for outbound).
 * `accountId` is the page — the business side of the channel.
 */
export function toMetaIngestRow(args: {
  message: ConvoMessage;
  participants: unknown;
  pageExternalId: string;
  channel: 'messenger' | 'instagram';
  /** Page's display name (from meta_assets.name) — the sender_name for
   *  outbound (page-authored) messages. */
  pageName?: string | null;
}): IngestRow | null {
  const fromId = extractId(args.message.from);
  if (!fromId) return null;
  const direction: 'inbound' | 'outbound' = fromId === args.pageExternalId ? 'outbound' : 'inbound';
  const participantIds = extractParticipantIds(args.participants);
  const customerId = participantIds.find((id) => id !== args.pageExternalId) ?? (direction === 'inbound' ? fromId : null);
  if (!customerId) return null; // can't resolve the non-page side (e.g. malformed participants) — skip
  const occurredAt = args.message.created_time ? Date.parse(args.message.created_time) : NaN;
  // Outbound = the page authored it → its catalog name. Inbound = the
  // customer → their participant name, falling back to the per-message
  // `from` name (Graph sometimes omits a participant from the top-level list).
  const senderName =
    direction === 'outbound'
      ? (args.pageName ?? null)
      : (extractParticipantNames(args.participants).get(fromId) ?? extractName(args.message.from));
  return {
    clientId: `meta:${args.channel}:${args.message.id}`,
    direction,
    channel: args.channel,
    accountId: args.pageExternalId,
    chatId: customerId,
    isGroup: false,
    senderId: fromId,
    senderName,
    senderHandle: null,
    isBot: false,
    content: args.message.message ?? null,
    messageId: args.message.id,
    agentId: null,
    sessionKey: null,
    success: true,
    error: null,
    occurredAt: Number.isFinite(occurredAt) ? occurredAt : null,
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Pure mapping: Graph post/media insight metrics → meta_post_insights rows
// ---------------------------------------------------------------------------

type PostInsightRow = typeof metaPostInsights.$inferInsert;

/**
 * One row per metric that resolved to a finite number. Non-numeric metrics
 * (e.g. `post_reactions_by_type_total`'s breakdown object) degrade — counted,
 * not stored — rather than failing the post. `metrics` is only ever non-empty
 * here (graph-read's per-metric fallback already collapses "everything
 * failed" to `ok:false`, handled by the caller before this runs).
 */
export function metricInsightsToRows(
  metrics: MetricInsight[],
  meta: {
    orgId: string;
    assetId: string;
    platform: 'fb' | 'ig';
    postId: string;
    permalink: string | null;
    caption: string | null;
    mediaType: string | null;
    postedAt: Date | null;
    isPromoted: boolean;
  },
): { rows: PostInsightRow[]; nonNumeric: number } {
  const rows: PostInsightRow[] = [];
  let nonNumeric = 0;
  for (const m of metrics) {
    const period = m.period ?? 'lifetime';
    const last = m.values && m.values.length > 0 ? m.values[m.values.length - 1] : undefined;
    const num = last ? Number(last.value) : NaN;
    if (!Number.isFinite(num)) {
      nonNumeric++;
      continue;
    }
    rows.push({
      orgId: meta.orgId,
      assetId: meta.assetId,
      platform: meta.platform,
      postId: meta.postId,
      permalink: meta.permalink,
      caption: meta.caption,
      mediaType: meta.mediaType,
      postedAt: meta.postedAt,
      isPromoted: meta.isPromoted,
      metric: m.name,
      value: String(num),
      period,
    });
  }
  return { rows, nonNumeric };
}

/**
 * Engagement-count fallback (spec §10 gap: `read_insights` is unobtainable for
 * this app, so `postInsights`/`igMediaInsights` are permanently denied). These
 * three counts come straight off the post/media object via fields that only
 * need `pages_read_engagement` + a page token, so they land even when
 * `/insights` is 100% denied. Always emitted — including as `0` — so a synced
 * post always has *something* in `meta_post_insights` (that's the fix: an
 * empty Posts tab was the `metricsDenied` → zero-rows chain, not a UI bug).
 */
export function fallbackEngagementRows(
  post: { id: string } & Partial<PagePost> & Partial<IgMedia>,
  meta: {
    orgId: string;
    assetId: string;
    platform: 'fb' | 'ig';
    permalink: string | null;
    caption: string | null;
    mediaType: string | null;
    postedAt: Date | null;
    isPromoted: boolean;
  },
): PostInsightRow[] {
  // FB: only `shares` is fetchable (reactions/comments summaries need the
  // unobtainable `pages_read_user_content` — see PAGE_POST_FIELDS). Emit it
  // even when absent (Graph omits `shares` on never-shared posts) so every
  // post has an anchor row and renders; the summary metrics only appear if
  // the scope is ever granted — never fabricated as 0.
  const counts: Record<string, number | undefined> =
    meta.platform === 'fb'
      ? {
          shares_total: post.shares?.count ?? 0,
          ...(post.reactions?.summary?.total_count !== undefined && {
            reactions_total: post.reactions.summary.total_count,
          }),
          ...(post.comments?.summary?.total_count !== undefined && {
            comments_total: post.comments.summary.total_count,
          }),
        }
      : {
          reactions_total: post.like_count,
          comments_total: post.comments_count,
        };
  return Object.entries(counts).map(([metric, value]) => ({
    orgId: meta.orgId,
    assetId: meta.assetId,
    platform: meta.platform,
    postId: post.id,
    permalink: meta.permalink,
    caption: meta.caption,
    mediaType: meta.mediaType,
    postedAt: meta.postedAt,
    isPromoted: meta.isPromoted,
    metric,
    value: String(value ?? 0),
    period: 'lifetime',
  }));
}

function parseGraphDate(v: string | undefined): Date | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

// ---------------------------------------------------------------------------
// Pure mapping: Graph ad insight row → meta_ad_insights insert row
// ---------------------------------------------------------------------------

type AdInsightInsertRow = typeof metaAdInsights.$inferInsert;

export function adInsightRowToInsert(
  row: AdInsightRow,
  ctx: { orgId: string; adAccountId: string; currency: string | null },
): AdInsightInsertRow | null {
  if (!row.ad_id || !row.date_start) return null; // can't upsert without the unique-index columns
  return {
    orgId: ctx.orgId,
    adAccountId: ctx.adAccountId,
    campaignId: row.campaign_id ?? null,
    campaignName: row.campaign_name ?? null,
    adsetId: row.adset_id ?? null,
    adsetName: row.adset_name ?? null,
    adId: row.ad_id,
    adName: row.ad_name ?? null,
    date: row.date_start,
    spend: row.spend ?? null,
    impressions: row.impressions != null ? Number(row.impressions) : null,
    reach: row.reach != null ? Number(row.reach) : null,
    clicks: row.clicks != null ? Number(row.clicks) : null,
    ctr: row.ctr ?? null,
    cpc: row.cpc ?? null,
    actions: row.actions ?? [],
    currency: ctx.currency,
  };
}

// ---------------------------------------------------------------------------
// Batch upserts
// ---------------------------------------------------------------------------

async function upsertPostInsights(ctx: CoreCtx, rows: PostInsightRow[]): Promise<void> {
  if (rows.length === 0) return;
  await withOrgCore(ctx, async (tx) => {
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      await tx
        .insert(metaPostInsights)
        .values(chunk)
        .onConflictDoUpdate({
          target: [metaPostInsights.orgId, metaPostInsights.postId, metaPostInsights.metric, metaPostInsights.period],
          set: {
            value: sql`excluded.value`,
            permalink: sql`excluded.permalink`,
            caption: sql`excluded.caption`,
            mediaType: sql`excluded.media_type`,
            postedAt: sql`excluded.posted_at`,
            isPromoted: sql`excluded.is_promoted`,
            fetchedAt: sql`now()`,
          },
        });
    }
  });
}

/**
 * Catch-up pass for rows synced before this feature existed (or a run where
 * the ad-account read was tolerated as a failure): flips `is_promoted` on any
 * already-stored row whose `post_id` is in the current story-id set. Never
 * flips it back off — a post that stops being an ad is still "was promoted"
 * for reporting purposes.
 */
async function markPromotedPosts(ctx: CoreCtx, storyIds: Set<string>): Promise<void> {
  if (storyIds.size === 0) return;
  await withOrgCore(ctx, (tx) =>
    tx.execute(
      // drizzle renders a JS array as a parenthesized value list — valid for
      // `in`, NOT for `any()` (which wants a real PG array).
      sql`update meta_post_insights set is_promoted = true where org_id = ${ctx.tenantId} and post_id in ${[...storyIds]} and is_promoted = false`,
    ),
  );
}

async function upsertAdInsights(ctx: CoreCtx, rows: AdInsightInsertRow[]): Promise<void> {
  if (rows.length === 0) return;
  await withOrgCore(ctx, async (tx) => {
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      await tx
        .insert(metaAdInsights)
        .values(chunk)
        .onConflictDoUpdate({
          target: [metaAdInsights.orgId, metaAdInsights.adId, metaAdInsights.date],
          set: {
            campaignId: sql`excluded.campaign_id`,
            campaignName: sql`excluded.campaign_name`,
            adsetId: sql`excluded.adset_id`,
            adsetName: sql`excluded.adset_name`,
            adName: sql`excluded.ad_name`,
            spend: sql`excluded.spend`,
            impressions: sql`excluded.impressions`,
            reach: sql`excluded.reach`,
            clicks: sql`excluded.clicks`,
            ctr: sql`excluded.ctr`,
            cpc: sql`excluded.cpc`,
            actions: sql`excluded.actions`,
            currency: sql`excluded.currency`,
            fetchedAt: sql`now()`,
          },
        });
    }
  });
}

async function latestAdInsightDate(ctx: CoreCtx, adAccountId: string): Promise<string | null> {
  return withOrgCore(ctx, async (tx) => {
    const rows = (await tx.execute(
      sql`select max(date)::text as d from meta_ad_insights where org_id = ${ctx.tenantId} and ad_account_id = ${adAccountId}`,
    )) as unknown as Array<{ d: string | null }>;
    return rows[0]?.d ?? null;
  });
}

// ---------------------------------------------------------------------------
// Per-kind slice runners
// ---------------------------------------------------------------------------

type SliceResult = { cursor: string | null; counts: Record<string, number | string[]>; tokenExpired?: boolean };

/**
 * Aggregates every enabled ad account's promoted-post story ids into one set.
 * Per-account failures are tolerated (counted, not fatal) — same posture as
 * every other per-target Graph call in this file.
 */
async function collectPromotedStoryIds(
  userToken: string,
  adAccountAssets: MetaAsset[],
): Promise<{ storyIds: Set<string>; failed: number }> {
  const storyIds = new Set<string>();
  let failed = 0;
  for (const asset of adAccountAssets) {
    const res = await listAdStoryIds(asset.externalId, userToken, graphAuthOpts());
    if (res.ok) for (const id of res.data ?? []) storyIds.add(id);
    else failed++;
  }
  return { storyIds, failed };
}

async function syncPosts(ctx: CoreCtx, job: MetaSyncJob, assets: MetaAsset[], userToken: string): Promise<SliceResult> {
  const pageAssets = assets.filter((a) => a.kind === 'page');
  const adAccountAssets = assets.filter((a) => a.kind === 'ad_account');
  const targets = assets
    .filter((a) => a.kind === 'page' || a.kind === 'ig')
    .sort((a, b) => a.externalId.localeCompare(b.externalId))
    .map((a) => ({ asset: a, platform: (a.kind === 'ig' ? 'ig' : 'fb') as 'fb' | 'ig' }));

  const since = job.since ?? defaultSinceDate();
  const resume = parseResume(job.pageCursor);
  const counts = { postsProcessed: 0, metricsDenied: 0, metricsSkipped: 0, igSkipped: 0, adStoryFetchFailed: 0 };
  const rowsToUpsert: PostInsightRow[] = [];

  // read_insights is permanently unobtainable for this app (spec §10) — the
  // first denial in this slice proves it for every remaining post, so stop
  // spending a Graph call per post on it. Engagement-count fallback still
  // lands for every post regardless.
  let insightsDenied = false;

  const { storyIds, failed: adStoryFetchFailed } = userToken
    ? await collectPromotedStoryIds(userToken, adAccountAssets)
    : { storyIds: new Set<string>(), failed: 0 };
  counts.adStoryFetchFailed = adStoryFetchFailed;

  for (let i = resume.i; i < targets.length; i++) {
    const { asset, platform } = targets[i];
    const parentPage = platform === 'ig' ? pageAssets.find((p) => p.externalId === asset.parentPageId) : undefined;
    const token =
      platform === 'fb'
        ? decryptOrNull(asset.pageTokenCiphertext, asset.pageTokenIv)
        : decryptOrNull(parentPage?.pageTokenCiphertext, parentPage?.pageTokenIv);
    if (!token) {
      if (platform === 'ig') counts.igSkipped++;
      continue; // no usable token for this asset (permission/setup gap) — tolerate, next target
    }

    let page =
      i === resume.i && resume.next
        ? await fetchNextPage<PagePost | IgMedia>(resume.next, graphAuthOpts())
        : platform === 'fb'
          ? await listPagePosts(asset.externalId, token, { since }, graphAuthOpts())
          : await listIgMedia(asset.externalId, token, { since }, graphAuthOpts());

    for (;;) {
      if (!page.ok) {
        if (page.error === 'token_expired') return { cursor: null, counts, tokenExpired: true };
        break; // permission/other error on this asset — tolerate, move to next target
      }
      for (const post of page.data ?? []) {
        const mediaType = (post as IgMedia).media_type;
        const postMeta = {
          orgId: ctx.tenantId,
          assetId: asset.id,
          platform,
          permalink: (post as PagePost).permalink_url ?? (post as IgMedia).permalink ?? null,
          caption: (post as PagePost).message ?? (post as IgMedia).caption ?? null,
          mediaType: mediaType ?? null,
          postedAt: parseGraphDate((post as PagePost).created_time ?? (post as IgMedia).timestamp),
          isPromoted: storyIds.has(post.id),
        };
        // Always land the engagement-count fallback — regardless of whether
        // /insights is allowed — so the Posts tab always has rows to show.
        rowsToUpsert.push(...fallbackEngagementRows(post, postMeta));

        if (insightsDenied) {
          counts.metricsSkipped++;
        } else {
          const insights =
            platform === 'fb'
              ? await postInsights(post.id, token, graphAuthOpts())
              : await igMediaInsights(post.id, token, mediaType ?? 'IMAGE', graphAuthOpts());
          if (!insights.ok) {
            if (insights.error === 'token_expired') return { cursor: null, counts, tokenExpired: true };
            counts.metricsDenied++;
            insightsDenied = true;
          } else {
            const { rows } = metricInsightsToRows(insights.data ?? [], { ...postMeta, postId: post.id });
            rowsToUpsert.push(...rows);
          }
        }
        counts.postsProcessed++;
      }
      if (counts.postsProcessed >= MAX_POSTS_PER_SLICE) {
        await upsertPostInsights(ctx, rowsToUpsert);
        await markPromotedPosts(ctx, storyIds);
        return { cursor: serializeResume({ i, next: page.nextCursor }), counts };
      }
      if (!page.nextCursor) break;
      page = await fetchNextPage<PagePost | IgMedia>(page.nextCursor, graphAuthOpts());
    }
  }
  await upsertPostInsights(ctx, rowsToUpsert);
  await markPromotedPosts(ctx, storyIds);
  return { cursor: null, counts };
}

async function syncAds(ctx: CoreCtx, userToken: string, assets: MetaAsset[], job: MetaSyncJob): Promise<SliceResult> {
  const targets = assets.filter((a) => a.kind === 'ad_account').sort((a, b) => a.externalId.localeCompare(b.externalId));
  const resume = parseResume(job.pageCursor);
  const counts: { adRowsUpserted: number; accountsSkipped: number; skipErrors?: string[] } = {
    adRowsUpserted: 0,
    accountsSkipped: 0,
  };
  const rowsToUpsert: AdInsightInsertRow[] = [];
  const until = computeAdsUntil();

  for (let i = resume.i; i < targets.length; i++) {
    const asset = targets[i];
    // A job.since set explicitly (full-history "Sync now") wins over the
    // normal 2-day restatement window computed from the last synced date.
    const since = job.since ?? computeAdsSince(await latestAdInsightDate(ctx, asset.externalId));

    // Ad insights over a multi-year time_range are computed server-side by
    // Meta and can take well past the default 15s (a 36-month full-history
    // pull hit the client abort) — give these calls a longer leash.
    const adTimeout = { timeoutMs: 55_000 };
    // Meta rejects large daily×ad-level ranges outright ("Please reduce the
    // amount of data you're asking for", code 1) — chunk into ≤90-day windows.
    // The normal incremental path (≤90d since) is a single window, unchanged.
    const windows = adTimeWindows(since, until);
    const resumedAccount = i === resume.i;
    let w0 = resumedAccount && resume.cs ? windows.findIndex((w) => w.since === resume.cs) : 0;
    if (w0 < 0) w0 = 0;

    for (let w = w0; w < windows.length; w++) {
      let page =
        resumedAccount && w === w0 && resume.next
          ? await fetchNextPage<AdInsightRow>(resume.next, { ...graphAuthOpts(), ...adTimeout })
          : await adInsights(asset.externalId, userToken, windows[w], { ...graphAuthOpts(), ...adTimeout });

      let accountFailed = false;
      for (;;) {
        if (!page.ok) {
          if (page.error === 'token_expired') return { cursor: null, counts, tokenExpired: true };
          counts.accountsSkipped++;
          // Swallowed per-asset errors have twice hidden real regressions — keep
          // the first few (sanitized upstream by graph-read) in the job counts.
          if ((counts.skipErrors ??= []).length < 3) {
            counts.skipErrors.push(`${asset.externalId} ${windows[w].since}: ${page.error ?? `status ${page.status}`}`);
          }
          accountFailed = true;
          break;
        }
        for (const row of page.data ?? []) {
          const insertRow = adInsightRowToInsert(row, { orgId: ctx.tenantId, adAccountId: asset.externalId, currency: asset.currency });
          if (insertRow) {
            rowsToUpsert.push(insertRow);
            counts.adRowsUpserted++;
          }
        }
        if (counts.adRowsUpserted >= MAX_AD_ROWS_PER_SLICE) {
          await upsertAdInsights(ctx, rowsToUpsert);
          return { cursor: serializeResume({ i, next: page.nextCursor, cs: windows[w].since }), counts };
        }
        if (!page.nextCursor) break;
        page = await fetchNextPage<AdInsightRow>(page.nextCursor, { ...graphAuthOpts(), ...adTimeout });
      }
      if (accountFailed) break; // skip this account's remaining windows, move to the next account
    }
  }
  await upsertAdInsights(ctx, rowsToUpsert);
  return { cursor: null, counts };
}

async function syncMessages(ctx: CoreCtx, assets: MetaAsset[], job: MetaSyncJob): Promise<SliceResult> {
  const targets = assets
    .filter((a) => a.kind === 'page')
    .flatMap((a) => [
      { asset: a, platform: 'messenger' as const },
      { asset: a, platform: 'instagram' as const },
    ])
    .sort((a, b) => (a.asset.externalId + a.platform).localeCompare(b.asset.externalId + b.platform));
  const resume = parseResume(job.pageCursor);
  const counts = { conversationsProcessed: 0, messagesInserted: 0, instagramSkipped: 0 };

  for (let i = resume.i; i < targets.length; i++) {
    const { asset, platform } = targets[i];
    const token = decryptOrNull(asset.pageTokenCiphertext, asset.pageTokenIv);
    if (!token) continue;
    const channel = platform === 'messenger' ? 'messenger' : 'instagram';

    let page =
      i === resume.i && resume.next
        ? await fetchNextPage<Conversation>(resume.next, graphAuthOpts())
        : await listConversations(asset.externalId, token, { platform }, graphAuthOpts());

    for (;;) {
      if (!page.ok) {
        if (page.error === 'token_expired') return { cursor: null, counts, tokenExpired: true };
        // IG conversation read needs instagram_manage_messages, which this app's
        // login config may not grant yet (spec §10 risk #3) — tolerate, Messenger
        // still lands. Any other per-target error tolerates the same way.
        if (platform === 'instagram') counts.instagramSkipped++;
        break;
      }
      const ingestRows: IngestRow[] = [];
      for (const convo of page.data ?? []) {
        for (const msg of convo.messages?.data ?? []) {
          const row = toMetaIngestRow({
            message: msg,
            participants: convo.participants,
            pageExternalId: asset.externalId,
            channel,
            pageName: asset.name,
          });
          if (row) ingestRows.push(row);
        }
        counts.conversationsProcessed++;
      }
      if (ingestRows.length > 0) counts.messagesInserted += await insertMessages(ctx.tenantId, null, ingestRows);
      if (counts.conversationsProcessed >= MAX_CONVERSATIONS_PER_SLICE) {
        return { cursor: serializeResume({ i, next: page.nextCursor }), counts };
      }
      if (!page.nextCursor) break;
      page = await fetchNextPage<Conversation>(page.nextCursor, graphAuthOpts());
    }
  }
  return { cursor: null, counts };
}

// ---------------------------------------------------------------------------
// Connection helpers (token expiry — spec §6 "Token expiry check first")
// ---------------------------------------------------------------------------

async function getUsableConnection(ctx: CoreCtx) {
  const all = await listConnections(ctx);
  return all.find((c) => c.status !== 'revoked') ?? null;
}

function classifyExpiry(tokenExpiresAt: Date | null): 'ok' | 'expiring' | 'expired' {
  if (!tokenExpiresAt) return 'ok'; // business system-user tokens are usually never-expiring (spec §6 LIVE FACTS)
  const msLeft = tokenExpiresAt.getTime() - Date.now();
  if (msLeft < 0) return 'expired';
  if (msLeft < 7 * 24 * 60 * 60_000) return 'expiring';
  return 'ok';
}

async function markConnectionStatus(ctx: CoreCtx, connectionId: string, status: 'expiring' | 'expired'): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx
      .update(metaConnections)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(metaConnections.id, connectionId), eq(metaConnections.orgId, ctx.tenantId))),
  );
}

/** Cross-org: orgs with a non-revoked Meta connection — feeds the tick's enqueue-if-stale sweep. */
export async function listConnectedOrgIds(): Promise<string[]> {
  const db = getCoreDb();
  const rows = (await db.execute(sql`select distinct org_id from meta_connections where status != 'revoked'`)) as unknown as Array<{
    org_id: string;
  }>;
  return rows.map((r) => r.org_id);
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/** Claim `jobId` and advance it by one bounded slice. Never throws for a job-level failure — always resolves via finishJob/requeue. */
export async function runJob(ctx: CoreCtx, jobId: string): Promise<void> {
  if (!(await claimJob(ctx, jobId))) return; // already claimed elsewhere, or terminal
  const job = await getJobById(ctx, jobId);
  if (!job) return;

  const connection = await getUsableConnection(ctx);
  if (!connection) {
    await finishJob(ctx, jobId, 'failed', { error: 'no meta connection' });
    return;
  }

  const expiry = classifyExpiry(connection.tokenExpiresAt);
  if (expiry === 'expired') {
    await markConnectionStatus(ctx, connection.id, 'expired');
    await finishJob(ctx, jobId, 'failed', { error: 'token_expired' });
    return;
  }
  if (expiry === 'expiring' && connection.status !== 'expiring') {
    await markConnectionStatus(ctx, connection.id, 'expiring');
  }

  let userToken = '';
  if (job.kind === 'ads' || job.kind === 'posts') {
    const decrypted = decryptOrNull(connection.tokenCiphertext, connection.tokenIv);
    if (decrypted) {
      userToken = decrypted;
    } else if (job.kind === 'ads') {
      await finishJob(ctx, jobId, 'failed', { error: 'token decrypt failed' });
      return;
    }
    // posts: a missing user token just skips ad-story linkage (collectPromotedStoryIds) —
    // the posts/media themselves are read with per-asset page tokens, not this one.
  }

  const assets = (await listAssets(ctx, connection.id)).filter((a) => a.enabled);

  let result: SliceResult;
  try {
    if (job.kind === 'posts') result = await syncPosts(ctx, job, assets, userToken);
    else if (job.kind === 'ads') result = await syncAds(ctx, userToken, assets, job);
    else if (job.kind === 'messages') result = await syncMessages(ctx, assets, job);
    else {
      await finishJob(ctx, jobId, 'failed', { error: `unknown job kind: ${job.kind}` });
      return;
    }
  } catch (e) {
    await finishJob(ctx, jobId, 'failed', { error: e instanceof Error ? e.message : 'sync failed' });
    return;
  }

  if (result.tokenExpired) {
    await markConnectionStatus(ctx, connection.id, 'expired');
    await finishJob(ctx, jobId, 'failed', { error: 'token_expired' });
    return;
  }
  await recordProgress(ctx, jobId, { pageCursor: result.cursor, countsDelta: result.counts });
  if (result.cursor) await requeue(ctx, jobId);
  else await finishJob(ctx, jobId, 'succeeded');
}
