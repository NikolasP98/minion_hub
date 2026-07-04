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
 * fetchNextPage() calls omit this: Graph's `paging.next` links already echo the
 * appsecret_proof from the originating request.
 */
const graphAuthOpts = () => ({ appSecret: env.META_APP_SECRET });

const MAX_POSTS_PER_SLICE = 40;
const MAX_AD_ROWS_PER_SLICE = 90;
const MAX_CONVERSATIONS_PER_SLICE = 100;
const BACKFILL_DAYS = 90;

export function defaultSinceDate(days = BACKFILL_DAYS, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

export function computeAdsUntil(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
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

type Resume = { i: number; next?: string };
function parseResume(pageCursor: string | null): Resume {
  if (!pageCursor) return { i: 0 };
  try {
    const p = JSON.parse(pageCursor) as Partial<Resume>;
    return typeof p.i === 'number' ? { i: p.i, next: p.next } : { i: 0 };
  } catch {
    return { i: 0 };
  }
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
      metric: m.name,
      value: String(num),
      period,
    });
  }
  return { rows, nonNumeric };
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
            fetchedAt: sql`now()`,
          },
        });
    }
  });
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

type SliceResult = { cursor: string | null; counts: Record<string, number>; tokenExpired?: boolean };

async function syncPosts(ctx: CoreCtx, job: MetaSyncJob, assets: MetaAsset[]): Promise<SliceResult> {
  const pageAssets = assets.filter((a) => a.kind === 'page');
  const targets = assets
    .filter((a) => a.kind === 'page' || a.kind === 'ig')
    .sort((a, b) => a.externalId.localeCompare(b.externalId))
    .map((a) => ({ asset: a, platform: (a.kind === 'ig' ? 'ig' : 'fb') as 'fb' | 'ig' }));

  const since = job.since ?? defaultSinceDate();
  const resume = parseResume(job.pageCursor);
  const counts = { postsProcessed: 0, metricsDenied: 0, igSkipped: 0 };
  const rowsToUpsert: PostInsightRow[] = [];

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
        ? await fetchNextPage<PagePost | IgMedia>(resume.next)
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
        const insights =
          platform === 'fb'
            ? await postInsights(post.id, token, graphAuthOpts())
            : await igMediaInsights(post.id, token, mediaType ?? 'IMAGE', graphAuthOpts());
        if (!insights.ok) {
          if (insights.error === 'token_expired') return { cursor: null, counts, tokenExpired: true };
          counts.metricsDenied++;
        } else {
          const { rows } = metricInsightsToRows(insights.data ?? [], {
            orgId: ctx.tenantId,
            assetId: asset.id,
            platform,
            postId: post.id,
            permalink: (post as PagePost).permalink_url ?? (post as IgMedia).permalink ?? null,
            caption: (post as PagePost).message ?? (post as IgMedia).caption ?? null,
            mediaType: mediaType ?? null,
            postedAt: parseGraphDate((post as PagePost).created_time ?? (post as IgMedia).timestamp),
          });
          rowsToUpsert.push(...rows);
        }
        counts.postsProcessed++;
      }
      if (counts.postsProcessed >= MAX_POSTS_PER_SLICE) {
        await upsertPostInsights(ctx, rowsToUpsert);
        return { cursor: serializeResume({ i, next: page.nextCursor }), counts };
      }
      if (!page.nextCursor) break;
      page = await fetchNextPage<PagePost | IgMedia>(page.nextCursor);
    }
  }
  await upsertPostInsights(ctx, rowsToUpsert);
  return { cursor: null, counts };
}

async function syncAds(ctx: CoreCtx, userToken: string, assets: MetaAsset[], job: MetaSyncJob): Promise<SliceResult> {
  const targets = assets.filter((a) => a.kind === 'ad_account').sort((a, b) => a.externalId.localeCompare(b.externalId));
  const resume = parseResume(job.pageCursor);
  const counts = { adRowsUpserted: 0, accountsSkipped: 0 };
  const rowsToUpsert: AdInsightInsertRow[] = [];
  const until = computeAdsUntil();

  for (let i = resume.i; i < targets.length; i++) {
    const asset = targets[i];
    const since = computeAdsSince(await latestAdInsightDate(ctx, asset.externalId));

    let page =
      i === resume.i && resume.next
        ? await fetchNextPage<AdInsightRow>(resume.next)
        : await adInsights(asset.externalId, userToken, { since, until }, graphAuthOpts());

    for (;;) {
      if (!page.ok) {
        if (page.error === 'token_expired') return { cursor: null, counts, tokenExpired: true };
        counts.accountsSkipped++;
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
        return { cursor: serializeResume({ i, next: page.nextCursor }), counts };
      }
      if (!page.nextCursor) break;
      page = await fetchNextPage<AdInsightRow>(page.nextCursor);
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
        ? await fetchNextPage<Conversation>(resume.next)
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
      page = await fetchNextPage<Conversation>(page.nextCursor);
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
  if (job.kind === 'ads') {
    const decrypted = decryptOrNull(connection.tokenCiphertext, connection.tokenIv);
    if (!decrypted) {
      await finishJob(ctx, jobId, 'failed', { error: 'token decrypt failed' });
      return;
    }
    userToken = decrypted;
  }

  const assets = (await listAssets(ctx, connection.id)).filter((a) => a.enabled);

  let result: SliceResult;
  try {
    if (job.kind === 'posts') result = await syncPosts(ctx, job, assets);
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
