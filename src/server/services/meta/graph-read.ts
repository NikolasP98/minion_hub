/**
 * Meta Graph API — hub-side READ client (spec §4, 2026-07-04 meta-business-integration).
 *
 * Pure fetch helpers: injectable `fetchImpl`, no `$env` imports, no logging.
 * App secrets/tokens are passed in by the caller (OAuth broker / sync service)
 * — this module never reads env so it stays trivially unit-testable.
 *
 * Every helper returns a `GraphResult<T>` envelope: `{ ok, data?, nextCursor?,
 * error?, status, usage? }`. `nextCursor` is the raw Graph `paging.next` URL
 * (already carries its own access_token, like all Graph paging links) — pass
 * it to `fetchNextPage()` to resume. `usage` surfaces the parsed
 * `X-Business-Use-Case-Usage` (or `X-App-Usage`) header when Graph sends one.
 *
 * Token errors: Graph OAuth error code 190 (invalid/expired token — covers
 * subcodes like 463 expired, 460 password-changed) collapses to
 * `error: 'token_expired'` so callers can flip `meta_connections.status`.
 *
 * Metric tolerance (postInsights / igMediaInsights): Graph's `/insights`
 * rejects the WHOLE request if any one metric in a comma-joined `metric=`
 * list is unsupported (error code 100). Chosen approach: try the batched
 * call first (1 HTTP round-trip in the common case); only on a code-100
 * failure, fall back to one GET per metric and return the metrics that
 * succeeded plus a `failedMetrics` list for the ones that didn't. A metric
 * name that never existed still fails; a metric the account doesn't support
 * degrades instead of failing the whole insights fetch.
 *
 * IG media insight metrics vary by `media_type` (spec §4 + §10.1, called out
 * as the most drift-prone part of this spec — e.g. the `impressions`→`views`
 * migration). The per-type defaults below are a reasonable starting point;
 * smoke-test against live assets and pass `{ metrics: [...] }` to override.
 */

import { createHmac } from 'node:crypto';

export const DEFAULT_GRAPH_BASE_URL = 'https://graph.facebook.com';
export const DEFAULT_GRAPH_VERSION = 'v23.0';

export type GraphOpts = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
  graphVersion?: string;
  /**
   * The Meta App Secret. When set, every request carrying an `access_token`
   * also sends `appsecret_proof` = HMAC-SHA256(access_token, appSecret). Meta
   * rejects server-side calls with code 100 ("API calls from the server
   * require an appsecret_proof argument") when the app has "Require app secret
   * proof for server API calls" enabled — which is the default for this app.
   */
  appSecret?: string;
};

export type GraphResult<T> = {
  ok: boolean;
  data?: T;
  nextCursor?: string;
  error?: string;
  status: number;
  usage?: unknown;
};

type ResolvedOpts = {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  baseUrl: string;
  graphVersion: string;
  appSecret?: string;
};

function resolveOpts(opts: GraphOpts): ResolvedOpts {
  return {
    fetchImpl: opts.fetchImpl ?? fetch,
    timeoutMs: opts.timeoutMs ?? 15_000,
    baseUrl: opts.baseUrl ?? DEFAULT_GRAPH_BASE_URL,
    graphVersion: opts.graphVersion ?? DEFAULT_GRAPH_VERSION,
    appSecret: opts.appSecret,
  };
}

function buildUrl(path: string, params: Record<string, string | number | undefined>, o: ResolvedOpts): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v));
  }
  // appsecret_proof = HMAC-SHA256(access_token, app_secret) — required by Meta
  // for server-side calls when the app enforces it (see GraphOpts.appSecret).
  const token = params.access_token;
  if (o.appSecret && typeof token === 'string' && token) {
    qs.set('appsecret_proof', createHmac('sha256', o.appSecret).update(token).digest('hex'));
  }
  return `${o.baseUrl.replace(/\/+$/, '')}/${o.graphVersion}/${path}?${qs.toString()}`;
}

/** Drop the query string so a URL is safe to embed in an error/log line. */
function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    return u.toString();
  } catch {
    return url.split('?')[0] ?? url;
  }
}

/** Strip the URL and any of its query-param values (tokens/secrets/codes) out of an error string. */
function sanitizeErrorMessage(message: string, url: string): string {
  let out = message.split(url).join(redactUrl(url));
  try {
    for (const [, value] of new URL(url).searchParams) {
      if (value.length > 3) out = out.split(value).join('***');
    }
  } catch {
    // not a parseable URL — nothing further to scrub
  }
  return out;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

type GraphErrorBody = {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
};

function classifyGraphError(body: unknown): string {
  const err = (body as GraphErrorBody | undefined)?.error;
  if (!err) return 'graph request failed';
  if (err.code === 190) return 'token_expired';
  const suffix =
    err.code != null ? ` (code ${err.code}${err.error_subcode != null ? ` subcode ${err.error_subcode}` : ''})` : '';
  return `${err.message ?? 'graph error'}${suffix}`;
}

function isUnsupportedMetricError(body: unknown): boolean {
  return (body as GraphErrorBody | undefined)?.error?.code === 100;
}

function extractUsage(res: Response): unknown {
  const raw = res.headers.get('x-business-use-case-usage') ?? res.headers.get('x-app-usage');
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

type RawResult = { ok: boolean; status: number; body?: unknown; error?: string; usage?: unknown };

async function graphRequest(url: string, base: Pick<ResolvedOpts, 'fetchImpl' | 'timeoutMs'>): Promise<RawResult> {
  let res: Response;
  try {
    res = await base.fetchImpl(url, { signal: AbortSignal.timeout(base.timeoutMs) });
  } catch (err) {
    return { ok: false, status: 0, error: sanitizeErrorMessage(String(err), url) };
  }
  const body = await safeJson(res);
  const usage = extractUsage(res);
  if (!res.ok) {
    return { ok: false, status: res.status, error: classifyGraphError(body), body, usage };
  }
  return { ok: true, status: res.status, body, usage };
}

function unwrapList<T>(body: unknown): { data: T[]; nextCursor?: string } {
  const b = body as { data?: T[]; paging?: { next?: string } } | undefined;
  return { data: Array.isArray(b?.data) ? b.data : [], nextCursor: b?.paging?.next };
}

/** Resume any list endpoint from its `nextCursor` (Graph's `paging.next`, already fully-formed). */
export async function fetchNextPage<T = unknown>(
  nextUrl: string,
  opts: Pick<GraphOpts, 'fetchImpl' | 'timeoutMs'> = {},
): Promise<GraphResult<T[]>> {
  const base = { fetchImpl: opts.fetchImpl ?? fetch, timeoutMs: opts.timeoutMs ?? 15_000 };
  const res = await graphRequest(nextUrl, base);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };
  const { data, nextCursor } = unwrapList<T>(res.body);
  return { ok: true, status: res.status, data, nextCursor, usage: res.usage };
}

// ---------------------------------------------------------------------------
// OAuth token exchange
// ---------------------------------------------------------------------------

export type TokenResponse = { access_token: string; token_type?: string; expires_in?: number };

export async function exchangeCodeForToken(
  params: { appId: string; appSecret: string; code: string; redirectUri: string },
  opts: GraphOpts = {},
): Promise<GraphResult<TokenResponse>> {
  const o = resolveOpts(opts);
  const url = buildUrl(
    'oauth/access_token',
    { client_id: params.appId, client_secret: params.appSecret, redirect_uri: params.redirectUri, code: params.code },
    o,
  );
  const res = await graphRequest(url, o);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };
  return { ok: true, status: res.status, data: res.body as TokenResponse, usage: res.usage };
}

export async function extendUserToken(
  params: { appId: string; appSecret: string; shortToken: string },
  opts: GraphOpts = {},
): Promise<GraphResult<TokenResponse>> {
  const o = resolveOpts(opts);
  const url = buildUrl(
    'oauth/access_token',
    {
      grant_type: 'fb_exchange_token',
      client_id: params.appId,
      client_secret: params.appSecret,
      fb_exchange_token: params.shortToken,
    },
    o,
  );
  const res = await graphRequest(url, o);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };
  return { ok: true, status: res.status, data: res.body as TokenResponse, usage: res.usage };
}

// ---------------------------------------------------------------------------
// Asset enumeration
// ---------------------------------------------------------------------------

export type PageWithToken = {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: { id: string; username?: string };
};

export async function listPagesWithTokens(
  userToken: string,
  opts: GraphOpts = {},
): Promise<GraphResult<PageWithToken[]>> {
  const o = resolveOpts(opts);
  const url = buildUrl(
    'me/accounts',
    { fields: 'id,name,access_token,instagram_business_account{id,username}', access_token: userToken },
    o,
  );
  const res = await graphRequest(url, o);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };
  const { data, nextCursor } = unwrapList<PageWithToken>(res.body);
  return { ok: true, status: res.status, data, nextCursor, usage: res.usage };
}

export type AdAccount = { id: string; name?: string; currency?: string; account_status?: number };

export async function listAdAccounts(userToken: string, opts: GraphOpts = {}): Promise<GraphResult<AdAccount[]>> {
  const o = resolveOpts(opts);
  const url = buildUrl('me/adaccounts', { fields: 'id,name,currency,account_status', access_token: userToken }, o);
  const res = await graphRequest(url, o);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };
  const { data, nextCursor } = unwrapList<AdAccount>(res.body);
  return { ok: true, status: res.status, data, nextCursor, usage: res.usage };
}

// ---------------------------------------------------------------------------
// Posts / IG media + insights (metric-tolerant)
// ---------------------------------------------------------------------------

export type MetricInsight = {
  name: string;
  period?: string;
  title?: string;
  description?: string;
  values?: Array<{ value: unknown; end_time?: string }>;
};

/**
 * Batched metric fetch with per-metric fallback. See file-header note on the
 * chosen approach: batch first, degrade to one-GET-per-metric only when the
 * batch fails with code 100 (unsupported metric), and surface `failedMetrics`
 * for whichever ones still don't resolve individually.
 */
async function fetchMetricsWithFallback(
  path: string,
  token: string,
  metrics: string[],
  opts: GraphOpts,
): Promise<GraphResult<MetricInsight[]> & { failedMetrics?: string[] }> {
  const o = resolveOpts(opts);
  const url = buildUrl(path, { metric: metrics.join(','), access_token: token }, o);
  const res = await graphRequest(url, o);
  if (res.ok) {
    const { data, nextCursor } = unwrapList<MetricInsight>(res.body);
    return { ok: true, status: res.status, data, nextCursor, usage: res.usage };
  }
  if (!isUnsupportedMetricError(res.body) || metrics.length <= 1) {
    return { ok: false, status: res.status, error: res.error, usage: res.usage };
  }

  const perMetric = await Promise.all(
    metrics.map(async (metric) => {
      const singleUrl = buildUrl(path, { metric, access_token: token }, o);
      return { metric, res: await graphRequest(singleUrl, o) };
    }),
  );
  const data: MetricInsight[] = [];
  const failedMetrics: string[] = [];
  for (const { metric, res: single } of perMetric) {
    if (single.ok) data.push(...unwrapList<MetricInsight>(single.body).data);
    else failedMetrics.push(metric);
  }
  if (data.length === 0) {
    return { ok: false, status: res.status, error: res.error, failedMetrics, usage: res.usage };
  }
  return { ok: true, status: 200, data, failedMetrics };
}

export type PagePost = {
  id: string;
  permalink_url?: string;
  message?: string;
  created_time?: string;
  /** Top-level Post field (not a summary edge) — `{ count }` or absent if never shared. */
  shares?: { count?: number };
  /** `reactions.summary(total_count).limit(0)` — total_count only, no per-reaction data page. */
  reactions?: { summary?: { total_count?: number } };
  /** `comments.summary(total_count).limit(0)` — same shape as reactions. */
  comments?: { summary?: { total_count?: number } };
};

// engagement counts need only `pages_read_engagement` + a page token — unlike
// `/insights`, which needs `read_insights` (unavailable to this app, spec
// meta-business-integration §10 gap). These give the Posts tab non-zero data.
const PAGE_POST_FIELDS =
  'id,permalink_url,message,created_time,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)';

export async function listPagePosts(
  pageId: string,
  pageToken: string,
  params: { since?: string } = {},
  opts: GraphOpts = {},
): Promise<GraphResult<PagePost[]>> {
  const o = resolveOpts(opts);
  const url = buildUrl(
    `${pageId}/posts`,
    { fields: PAGE_POST_FIELDS, since: params.since, access_token: pageToken },
    o,
  );
  const res = await graphRequest(url, o);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };
  const { data, nextCursor } = unwrapList<PagePost>(res.body);
  return { ok: true, status: res.status, data, nextCursor, usage: res.usage };
}

const DEFAULT_POST_METRICS = ['post_impressions', 'post_impressions_unique', 'post_clicks', 'post_reactions_by_type_total'];

export async function postInsights(
  postId: string,
  pageToken: string,
  opts: GraphOpts & { metrics?: string[] } = {},
): Promise<GraphResult<MetricInsight[]> & { failedMetrics?: string[] }> {
  return fetchMetricsWithFallback(`${postId}/insights`, pageToken, opts.metrics ?? DEFAULT_POST_METRICS, opts);
}

export type IgMedia = {
  id: string;
  caption?: string;
  media_type?: string;
  permalink?: string;
  timestamp?: string;
  /** Direct fields on IG media (no `read_insights` needed) — engagement fallback. */
  like_count?: number;
  comments_count?: number;
};

const IG_MEDIA_FIELDS = 'id,caption,media_type,permalink,timestamp,like_count,comments_count';

export async function listIgMedia(
  igId: string,
  pageToken: string,
  params: { since?: string } = {},
  opts: GraphOpts = {},
): Promise<GraphResult<IgMedia[]>> {
  const o = resolveOpts(opts);
  const url = buildUrl(`${igId}/media`, { fields: IG_MEDIA_FIELDS, since: params.since, access_token: pageToken }, o);
  const res = await graphRequest(url, o);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };
  const { data, nextCursor } = unwrapList<IgMedia>(res.body);
  return { ok: true, status: res.status, data, nextCursor, usage: res.usage };
}

/**
 * Per-media-type metric defaults (spec §4/§10.1 — drift-prone, smoke-test
 * live). Override with `{ metrics: [...] }` when Graph's docs move.
 */
export const IG_MEDIA_METRICS_BY_TYPE: Record<string, string[]> = {
  IMAGE: ['reach', 'saved', 'likes', 'comments', 'shares'],
  VIDEO: ['reach', 'saved', 'likes', 'comments', 'shares', 'views'],
  CAROUSEL_ALBUM: ['reach', 'saved', 'likes', 'comments', 'shares'],
  REELS: ['reach', 'saved', 'likes', 'comments', 'shares', 'plays'],
};

export async function igMediaInsights(
  mediaId: string,
  pageToken: string,
  mediaType: string,
  opts: GraphOpts & { metrics?: string[] } = {},
): Promise<GraphResult<MetricInsight[]> & { failedMetrics?: string[] }> {
  const metrics = opts.metrics ?? IG_MEDIA_METRICS_BY_TYPE[mediaType.toUpperCase()] ?? IG_MEDIA_METRICS_BY_TYPE.IMAGE;
  return fetchMetricsWithFallback(`${mediaId}/insights`, pageToken, metrics, opts);
}

// ---------------------------------------------------------------------------
// Ads
// ---------------------------------------------------------------------------

export type AdInsightRow = {
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  ctr?: string;
  cpc?: string;
  actions?: Array<{ action_type: string; value: string }>;
  campaign_id?: string;
  campaign_name?: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  date_start?: string;
  date_stop?: string;
};

export async function adInsights(
  adAccountId: string,
  userToken: string,
  params: { since: string; until: string },
  opts: GraphOpts = {},
): Promise<GraphResult<AdInsightRow[]>> {
  const o = resolveOpts(opts);
  const accountPath = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const url = buildUrl(
    `${accountPath}/insights`,
    {
      level: 'ad',
      fields:
        'spend,impressions,reach,clicks,ctr,cpc,actions,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name',
      time_increment: 1,
      time_range: JSON.stringify({ since: params.since, until: params.until }),
      access_token: userToken,
    },
    o,
  );
  const res = await graphRequest(url, o);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };
  const { data, nextCursor } = unwrapList<AdInsightRow>(res.body);
  return { ok: true, status: res.status, data, nextCursor, usage: res.usage };
}

// ---------------------------------------------------------------------------
// Conversations (Messenger / IG DM)
// ---------------------------------------------------------------------------

export type Conversation = {
  id?: string;
  participants?: unknown;
  updated_time?: string;
  messages?: {
    data?: Array<{ id: string; from?: unknown; to?: unknown; message?: string; created_time?: string }>;
  };
};

export async function listConversations(
  pageId: string,
  pageToken: string,
  params: { platform: 'messenger' | 'instagram' },
  opts: GraphOpts = {},
): Promise<GraphResult<Conversation[]>> {
  const o = resolveOpts(opts);
  const url = buildUrl(
    `${pageId}/conversations`,
    {
      platform: params.platform,
      // {id,name} sub-fields on participants/from/to — the default id-only
      // shape leaves every imported ledger row's sender_name null.
      fields:
        'participants{id,name},updated_time,messages{id,from{id,name},to{id,name},message,created_time}',
      access_token: pageToken,
    },
    o,
  );
  const res = await graphRequest(url, o);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };
  const { data, nextCursor } = unwrapList<Conversation>(res.body);
  return { ok: true, status: res.status, data, nextCursor, usage: res.usage };
}
