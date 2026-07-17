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
  /**
   * `graph.facebook.com` is versioned (`/v23.0/...`); `graph.instagram.com`
   * (Instagram API with Instagram Login) is NOT — its endpoints hang directly
   * off the host root. Set `false` when `baseUrl` points at the IG host.
   * Defaults to `true` so every existing FB-Graph call is unaffected.
   */
  versioned?: boolean;
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
  versioned: boolean;
};

function resolveOpts(opts: GraphOpts): ResolvedOpts {
  return {
    fetchImpl: opts.fetchImpl ?? fetch,
    timeoutMs: opts.timeoutMs ?? 15_000,
    baseUrl: opts.baseUrl ?? DEFAULT_GRAPH_BASE_URL,
    graphVersion: opts.graphVersion ?? DEFAULT_GRAPH_VERSION,
    appSecret: opts.appSecret,
    versioned: opts.versioned ?? true,
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
  const versionSegment = o.versioned ? `${o.graphVersion}/` : '';
  return `${o.baseUrl.replace(/\/+$/, '')}/${versionSegment}${path}?${qs.toString()}`;
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

/**
 * Resume any list endpoint from its `nextCursor` (Graph's `paging.next`,
 * already fully-formed). Some endpoints' paging links echo the original
 * `appsecret_proof`, but /insights links do NOT (live-verified: page 2 of a
 * chunked ad-insights pull failed with code 100) — so when `appSecret` is
 * provided, the proof is (re)derived from the link's own access_token.
 */
export async function fetchNextPage<T = unknown>(
  nextUrl: string,
  opts: Pick<GraphOpts, 'fetchImpl' | 'timeoutMs' | 'appSecret'> = {},
): Promise<GraphResult<T[]>> {
  const base = { fetchImpl: opts.fetchImpl ?? fetch, timeoutMs: opts.timeoutMs ?? 15_000 };
  let url = nextUrl;
  if (opts.appSecret) {
    try {
      const u = new URL(nextUrl);
      const token = u.searchParams.get('access_token');
      if (token && !u.searchParams.get('appsecret_proof')) {
        u.searchParams.set('appsecret_proof', createHmac('sha256', opts.appSecret).update(token).digest('hex'));
        url = u.toString();
      }
    } catch {
      // unparseable link — send as-is and let Graph report the real problem
    }
  }
  const res = await graphRequest(url, base);
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
// Instagram API with Instagram Login — a second, independent OAuth family
// (spec 2026-07-05-instagram-login-integration). Distinct app id/secret from
// the FLB flow above, distinct authorize host (www.instagram.com — the
// redirect itself lives in the route, not here), and a distinct, unversioned
// Graph host (`graph.instagram.com`, see GraphOpts.versioned).
// ---------------------------------------------------------------------------

export type IgShortLivedToken = { access_token: string; user_id?: string; permissions?: string[] };

/**
 * `POST https://api.instagram.com/oauth/access_token` — form-encoded body,
 * NOT the query-string GET the FB exchange above uses, so this can't reuse
 * `buildUrl`/`graphRequest`; it's a standalone fetch call with the same
 * result envelope and error sanitization.
 */
export async function exchangeIgCodeForToken(
  params: { appId: string; appSecret: string; code: string; redirectUri: string },
  opts: Pick<GraphOpts, 'fetchImpl' | 'timeoutMs'> = {},
): Promise<GraphResult<IgShortLivedToken>> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const url = 'https://api.instagram.com/oauth/access_token';
  const body = new URLSearchParams({
    client_id: params.appId,
    client_secret: params.appSecret,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
    code: params.code,
  });
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, status: 0, error: sanitizeErrorMessage(String(err), url) };
  }
  const responseBody = await safeJson(res);
  if (!res.ok) return { ok: false, status: res.status, error: classifyGraphError(responseBody) };
  return { ok: true, status: res.status, data: responseBody as IgShortLivedToken };
}

export type IgLongLivedToken = { access_token: string; token_type?: string; expires_in?: number };

/**
 * `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token`
 * — reuses `buildUrl`/`graphRequest` (a GET-with-query-params shape, like the
 * FB exchange), just against the unversioned IG host. Caller passes
 * `{ baseUrl: 'https://graph.instagram.com', versioned: false }`.
 */
export async function exchangeIgLongLivedToken(
  params: { appSecret: string; shortToken: string },
  opts: GraphOpts = {},
): Promise<GraphResult<IgLongLivedToken>> {
  const o = resolveOpts({ baseUrl: 'https://graph.instagram.com', versioned: false, ...opts });
  const url = buildUrl(
    'access_token',
    { grant_type: 'ig_exchange_token', client_secret: params.appSecret, access_token: params.shortToken },
    o,
  );
  const res = await graphRequest(url, o);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };
  return { ok: true, status: res.status, data: res.body as IgLongLivedToken, usage: res.usage };
}

/**
 * `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token`
 * — a DISTINCT path from the long-lived exchange above, not the same path
 * with a different `grant_type` (verified against Meta's dedicated refresh
 * reference page, spec §2.4).
 */
export async function refreshIgToken(
  params: { token: string },
  opts: GraphOpts = {},
): Promise<GraphResult<IgLongLivedToken>> {
  const o = resolveOpts({ baseUrl: 'https://graph.instagram.com', versioned: false, ...opts });
  const url = buildUrl('refresh_access_token', { grant_type: 'ig_refresh_token', access_token: params.token }, o);
  const res = await graphRequest(url, o);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };
  return { ok: true, status: res.status, data: res.body as IgLongLivedToken, usage: res.usage };
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
  /** Only populated if the app ever gains `pages_read_user_content` — see PAGE_POST_FIELDS. */
  reactions?: { summary?: { total_count?: number } };
  /** Same gating as `reactions`. */
  comments?: { summary?: { total_count?: number } };
  /** Post preview image (temporary CDN url — mirror it, never persist directly; see meta-post-thumbnail-mirroring spec §5). */
  full_picture?: string;
};

// `shares` needs only `pages_read_engagement` + a page token. The
// `reactions.summary(...)`/`comments.summary(...)` edges were verified LIVE
// (v23.0, 2026-07-04) to 400 with "(#10) requires 'pages_read_user_content'"
// — a permission this app cannot obtain — and one denied sub-field rejects the
// ENTIRE fields request, so they must stay out of the list.
//
// `full_picture` is a plain top-level field (not a `.summary()` sub-field
// edge like reactions/comments above), so it should not carry the same
// all-or-nothing denial risk — but its permission requirement is unverified
// (spec §5: report the finding, don't fabricate). Kept last/isolated so a
// future denial is easy to spot and drop without touching the rest.
const PAGE_POST_FIELDS = 'id,permalink_url,message,created_time,shares,full_picture';

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
  /** Preview image/video urls (temporary CDN urls — mirror, never persist directly). See `pickPreviewUrl`. */
  media_url?: string;
  thumbnail_url?: string;
};

// media_url/thumbnail_url verified live 2026-07-05 under instagram_business_basic, no appsecret_proof (spec §5).
const IG_MEDIA_FIELDS = 'id,caption,media_type,permalink,timestamp,like_count,comments_count,media_url,thumbnail_url';

/**
 * Which URL to render as a post's preview thumbnail (spec §5/§7). VIDEO/REELS
 * carry the video itself in `media_url` — `thumbnail_url` is their actual
 * still-image preview. IMAGE/CAROUSEL_ALBUM (and any other type) use
 * `media_url` directly. Falls back to the FB `full_picture` field, then null.
 */
export function pickPreviewUrl(media: {
  media_type?: string | null;
  media_url?: string | null;
  thumbnail_url?: string | null;
  full_picture?: string | null;
}): string | null {
  const isVideoLike = media.media_type === 'VIDEO' || media.media_type === 'REELS';
  if (isVideoLike && media.thumbnail_url) return media.thumbnail_url;
  return media.media_url ?? media.full_picture ?? null;
}

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
// Ad → post linkage (which organic posts are also running as ads)
// ---------------------------------------------------------------------------

export type AdWithStory = {
  id?: string;
  creative?: { effective_object_story_id?: string; effective_instagram_media_id?: string; thumbnail_url?: string };
};

export type AdStoryLink = {
  adId: string;
  storyId: string | null;
  /** IG media id the ad ran as (`effective_instagram_media_id`) — matches an
   * organic IG post's id when the ad boosted an existing post, else a dark IG
   * creative. Lets a boosted IG post be flagged the same way FB story ids do. */
  igMediaId: string | null;
  thumbnailUrl: string | null;
};

// Most ad creatives are DARK posts (never published to the page feed), so
// `effective_object_story_id` alone gives the campaigns-page ad preview
// nothing to mirror. `thumbnail_url` is the creative's own preview image —
// pull it too so dark posts can still get a real thumbnail (spec WP-E:
// meta-sync feeds it into the existing meta_post_media mirror pipeline).
// Not attempting the `thumbnail_width(512).thumbnail_height(512)` Graph
// modifier syntax here — unconfirmed whether that chains onto a nested field
// expansion like this one vs. only working as a top-level query param on a
// direct creative-node GET. Plain field, so the default (often small/cropped)
// thumbnail size — acceptable for 40px table cells, revisit if larger is needed.
const AD_FIELDS = 'id,creative{effective_object_story_id,effective_instagram_media_id,thumbnail_url}';

/**
 * Paginates `act_X/ads` and returns every ad's id alongside its creative's
 * `effective_object_story_id` — a `{page_id}_{post_id}` id, the same format
 * `/{page}/posts` returns — or `null` when the ad has no linked organic post
 * (dark post / deleted creative) — and its creative's `thumbnail_url` (also
 * `null` when absent). Aggregates all pages itself (unlike the other `list*`
 * helpers here, which return one page + a cursor) since callers want the
 * full per-ad set: persisting the ad→post link (`meta_ad_posts`) AND deriving
 * the promoted-story-id set for `markPromotedPosts` from one call.
 */
export async function listAdsWithStoryIds(
  adAccountId: string,
  userToken: string,
  opts: GraphOpts = {},
): Promise<GraphResult<AdStoryLink[]>> {
  const o = resolveOpts(opts);
  const accountPath = adAccountId.startsWith('act_') ? adAccountId : `act_${adAccountId}`;
  const url = buildUrl(`${accountPath}/ads`, { fields: AD_FIELDS, limit: 100, access_token: userToken }, o);
  const res = await graphRequest(url, o);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };

  const toLink = (ad: AdWithStory): AdStoryLink | null =>
    ad.id
      ? {
          adId: ad.id,
          storyId: ad.creative?.effective_object_story_id ?? null,
          igMediaId: ad.creative?.effective_instagram_media_id ?? null,
          thumbnailUrl: ad.creative?.thumbnail_url ?? null,
        }
      : null;

  const out: AdStoryLink[] = [];
  let { data, nextCursor } = unwrapList<AdWithStory>(res.body);
  for (const ad of data) {
    const link = toLink(ad);
    if (link) out.push(link);
  }
  while (nextCursor) {
    // Some paging.next links don't echo the original appsecret_proof (live-verified
    // on /insights) — re-derive it from the link's own access_token, same as every
    // other fetchNextPage call site in this file.
    const page = await fetchNextPage<AdWithStory>(nextCursor, { fetchImpl: o.fetchImpl, timeoutMs: o.timeoutMs, appSecret: o.appSecret });
    if (!page.ok) break; // tolerate a mid-pagination failure — return what's collected so far
    for (const ad of page.data ?? []) {
      const link = toLink(ad);
      if (link) out.push(link);
    }
    nextCursor = page.nextCursor;
  }
  return { ok: true, status: res.status, data: out, usage: res.usage };
}

// ---------------------------------------------------------------------------
// Post detail — on-demand rich media (spec 2026-07-05-socials-rename-detail-pages §5.3)
// ---------------------------------------------------------------------------

export type IgMediaDetail = {
  id?: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  children?: { data?: Array<{ media_type?: string; media_url?: string; thumbnail_url?: string }> };
};

const IG_MEDIA_DETAIL_FIELDS = 'media_type,media_url,thumbnail_url,children{media_type,media_url,thumbnail_url}';

/** IG media node + carousel children, for the post-detail "rich media" enrichment. Unversioned host, no appsecret_proof (spec §5.3). */
export async function igMediaDetail(
  mediaId: string,
  token: string,
  opts: Pick<GraphOpts, 'fetchImpl' | 'timeoutMs'> = {},
): Promise<GraphResult<IgMediaDetail>> {
  const o = resolveOpts({ baseUrl: 'https://graph.instagram.com', versioned: false, ...opts });
  const url = buildUrl(mediaId, { fields: IG_MEDIA_DETAIL_FIELDS, access_token: token }, o);
  const res = await graphRequest(url, o);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };
  return { ok: true, status: res.status, data: res.body as IgMediaDetail, usage: res.usage };
}

export type FbAttachmentMedia = { image?: { src?: string }; source?: string };
export type FbAttachment = { media_type?: string; media?: FbAttachmentMedia; subattachments?: { data?: FbAttachment[] } };
export type FbAttachmentsResponse = { attachments?: { data?: FbAttachment[] } };

/**
 * FB post's `attachments{media,subattachments}` edge — the smoke-test call
 * (spec §5.3): expected to 100/permission-error on this app's scopes, in
 * which case the caller falls back to `fbPostFullPicture`. Versioned host,
 * page token, appsecret_proof (ordinary FB Graph call).
 */
export async function fbPostAttachments(
  postId: string,
  pageToken: string,
  opts: GraphOpts = {},
): Promise<GraphResult<FbAttachmentsResponse>> {
  const o = resolveOpts(opts);
  const url = buildUrl(postId, { fields: 'attachments{media,subattachments}', access_token: pageToken }, o);
  const res = await graphRequest(url, o);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };
  return { ok: true, status: res.status, data: res.body as FbAttachmentsResponse, usage: res.usage };
}

export type FbFullPicture = { full_picture?: string };

/** Fallback when `attachments` is denied — the same preview field the posts sync already reads. */
export async function fbPostFullPicture(
  postId: string,
  pageToken: string,
  opts: GraphOpts = {},
): Promise<GraphResult<FbFullPicture>> {
  const o = resolveOpts(opts);
  const url = buildUrl(postId, { fields: 'full_picture', access_token: pageToken }, o);
  const res = await graphRequest(url, o);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };
  return { ok: true, status: res.status, data: res.body as FbFullPicture, usage: res.usage };
}

// ---------------------------------------------------------------------------
// Comments (post-detail comments panel, spec §5.4)
// ---------------------------------------------------------------------------

export type IgComment = {
  id: string;
  text?: string;
  username?: string;
  // Third-party commenters' handle only comes through `from{username}` — the
  // top-level `username` is populated only for the token owner's own comments.
  from?: { id?: string; username?: string };
  timestamp?: string;
  like_count?: number;
  replies?: { data?: IgComment[] };
};

const IG_COMMENT_FIELDS =
  'id,text,username,from{id,username},timestamp,like_count,replies{id,text,username,from{id,username},timestamp,like_count}';

/** IG media comments (one page, ~50) — unversioned host, no appsecret_proof, spec §5.4. */
export async function igMediaComments(
  mediaId: string,
  token: string,
  opts: Pick<GraphOpts, 'fetchImpl' | 'timeoutMs'> = {},
): Promise<GraphResult<IgComment[]>> {
  const o = resolveOpts({ baseUrl: 'https://graph.instagram.com', versioned: false, ...opts });
  const url = buildUrl(`${mediaId}/comments`, { fields: IG_COMMENT_FIELDS, access_token: token }, o);
  const res = await graphRequest(url, o);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };
  const { data } = unwrapList<IgComment>(res.body);
  return { ok: true, status: res.status, data, usage: res.usage };
}

export type FbComment = {
  id: string;
  message?: string;
  from?: { name?: string };
  created_time?: string;
  like_count?: number;
};

const FB_COMMENT_FIELDS = 'id,message,from{name},created_time,like_count';

/**
 * FB post comments (one page) — page token, versioned host, appsecret_proof.
 * Expected to permission-deny on this app's scopes (`pages_read_user_content`
 * unconfirmed, spec §5.4 "availability caveat") — caller degrades to
 * `available:false` on any non-ok result, same posture as the media endpoint.
 */
export async function fbPostComments(
  postId: string,
  pageToken: string,
  opts: GraphOpts = {},
): Promise<GraphResult<FbComment[]>> {
  const o = resolveOpts(opts);
  const url = buildUrl(`${postId}/comments`, { fields: FB_COMMENT_FIELDS, access_token: pageToken }, o);
  const res = await graphRequest(url, o);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };
  const { data } = unwrapList<FbComment>(res.body);
  return { ok: true, status: res.status, data, usage: res.usage };
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

/**
 * The IG-Login professional-account id (the participant id that shows up in
 * conversations, e.g. `17841448369679209`) — distinct from the OAuth-flow user
 * id stored as the asset's external_id. Needed to classify DM direction
 * (from === this ⇒ outbound). graph.instagram.com, unversioned.
 */
export async function getIgLoginUser(
  token: string,
  opts: Pick<GraphOpts, 'fetchImpl' | 'timeoutMs'> = {},
): Promise<GraphResult<{ userId: string; username: string | null }>> {
  const o = resolveOpts({ baseUrl: 'https://graph.instagram.com', versioned: false, ...opts });
  const url = buildUrl('me', { fields: 'user_id,username', access_token: token }, o);
  const res = await graphRequest(url, o);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };
  const b = (res.body ?? {}) as { user_id?: unknown; username?: unknown };
  const userId = b.user_id != null ? String(b.user_id) : '';
  if (!userId) return { ok: false, status: res.status, error: 'no user_id', usage: res.usage };
  return { ok: true, status: res.status, data: { userId, username: b.username != null ? String(b.username) : null }, usage: res.usage };
}

type RawIgConvo = {
  id?: string;
  updated_time?: string;
  // `name` accepted too so normalizeIgConvo is idempotent (see below).
  participants?: { data?: Array<{ id?: string; username?: string; name?: string }> };
  messages?: { data?: Array<{ id: string; from?: { id?: string; username?: string; name?: string }; message?: string; created_time?: string }> };
};

/**
 * IG-Login DM conversations via graph.instagram.com `/me/conversations`
 * (spec 2026-07-05-instagram-login-integration §7 fast-follow). The IG-Login
 * shape uses `username` where the FB-Login graph uses `name`, so we normalize
 * username→name into the shared `Conversation` shape — the ledger mapper
 * (`toMetaIngestRow`) reads `.name`/`.id` and works unchanged.
 */
export async function listIgLoginConversations(
  token: string,
  opts: Pick<GraphOpts, 'fetchImpl' | 'timeoutMs'> = {},
): Promise<GraphResult<Conversation[]>> {
  const o = resolveOpts({ baseUrl: 'https://graph.instagram.com', versioned: false, ...opts });
  const url = buildUrl(
    'me/conversations',
    {
      platform: 'instagram',
      fields: 'updated_time,participants{id,username},messages{id,from{id,username},message,created_time}',
      access_token: token,
    },
    o,
  );
  const res = await graphRequest(url, o);
  if (!res.ok) return { ok: false, status: res.status, error: res.error, usage: res.usage };
  // Returns the RAW IG shape (username, not name); the caller normalizes every
  // page uniformly (this one AND fetchNextPage results) — see normalizeIgConvo.
  const { data, nextCursor } = unwrapList<Conversation>(res.body);
  return { ok: true, status: res.status, data, nextCursor, usage: res.usage };
}

/**
 * username→name so the shared FB-shaped mapper resolves handles unchanged.
 * IDEMPOTENT (`name ?? username`): safe to apply to an already-normalized
 * convo — the sync loop normalizes EVERY page, because `fetchNextPage` returns
 * the raw IG shape (username, not name) and would otherwise drop every
 * paginated commenter's handle.
 */
export function normalizeIgConvo(c: RawIgConvo): Conversation {
  return {
    id: c.id,
    updated_time: c.updated_time,
    participants: { data: (c.participants?.data ?? []).map((p) => ({ id: p.id, name: p.name ?? p.username })) },
    messages: {
      data: (c.messages?.data ?? []).map((m) => ({
        id: m.id,
        from: { id: m.from?.id, name: m.from?.name ?? m.from?.username },
        message: m.message,
        created_time: m.created_time,
      })),
    },
  };
}
