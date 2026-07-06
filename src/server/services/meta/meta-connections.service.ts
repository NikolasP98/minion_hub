/**
 * Meta OAuth broker + connection/asset persistence (spec §5,
 * 2026-07-04-meta-business-integration, WP4). Every query is org-scoped
 * through `withOrgCore`. Tokens are encrypted at rest via the shared
 * `auth/crypto` (`encrypt`/`decrypt` = AES-256-GCM, same as finance creds).
 * Never log a token; only ids/paths/counts.
 */
import { createHmac } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { withOrgCore } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { env } from '$env/dynamic/private';
import {
  metaConnections,
  metaAssets,
  metaSyncJobs,
  type MetaConnection,
  type MetaAsset,
} from '$server/db/pg-meta-schema';
import { encrypt } from '$server/auth/crypto';
import { ensureAccountInScope } from '../crm-contacts.service';
import {
  exchangeCodeForToken,
  extendUserToken,
  listPagesWithTokens,
  listAdAccounts,
  exchangeIgCodeForToken,
  exchangeIgLongLivedToken,
  type PageWithToken,
  type GraphOpts,
} from './graph-read';

const GRAPH_BASE = 'https://graph.facebook.com';
const GRAPH_VERSION = 'v23.0';

export function requireMetaEnv(): { appId: string; appSecret: string; loginConfigId: string } {
  const appId = env.META_APP_ID;
  const appSecret = env.META_APP_SECRET;
  const loginConfigId = env.META_LOGIN_CONFIG_ID;
  if (!appId || !appSecret || !loginConfigId) {
    throw new Error(
      'Meta OAuth is not configured — META_APP_ID, META_APP_SECRET and META_LOGIN_CONFIG_ID must all be set',
    );
  }
  return { appId, appSecret, loginConfigId };
}

/**
 * Instagram API with Instagram Login (spec 2026-07-05-instagram-login-integration
 * §3) — a separate Instagram App, own id/secret, no login-config concept.
 */
export function requireMetaIgEnv(): { igAppId: string; igAppSecret: string } {
  const igAppId = env.META_IG_APP_ID;
  const igAppSecret = env.META_IG_APP_SECRET;
  if (!igAppId || !igAppSecret) {
    throw new Error('Instagram Login OAuth is not configured — META_IG_APP_ID and META_IG_APP_SECRET must both be set');
  }
  return { igAppId, igAppSecret };
}

// ---------------------------------------------------------------------------
// debug_token + owned_pages fallback.
//
// Not exported from graph-read.ts (WP2-owned file, out of scope for this WP)
// — small enough to keep local, same fetch-envelope style (injectable
// fetchImpl, no throwing on HTTP/network failure).
// ---------------------------------------------------------------------------

type FetchImpl = typeof fetch;

export type DebugTokenData = {
  is_valid?: boolean;
  expires_at?: number; // unix seconds; 0 = never expires
  scopes?: string[];
  granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
  user_id?: string;
};

export async function debugToken(
  inputToken: string,
  appId: string,
  appSecret: string,
  fetchImpl: FetchImpl = fetch,
): Promise<{ ok: true; data: DebugTokenData } | { ok: false; error: string }> {
  const url = `${GRAPH_BASE}/${GRAPH_VERSION}/debug_token?input_token=${encodeURIComponent(inputToken)}&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`;
  try {
    const res = await fetchImpl(url);
    const body = (await res.json().catch(() => undefined)) as { data?: DebugTokenData; error?: { message?: string } } | undefined;
    if (!res.ok || !body?.data) return { ok: false, error: body?.error?.message ?? `debug_token failed (${res.status})` };
    return { ok: true, data: body.data };
  } catch (err) {
    return { ok: false, error: `debug_token request failed: ${String(err)}` };
  }
}

type OwnedPage = PageWithToken;

/**
 * Business-level page fallback for system-user tokens whose pages aren't
 * visible via `/me/accounts` (spec §5, WP4 brief). Best-effort: not certain
 * every business system-user token exposes a usable Business Manager id via
 * `granular_scopes` — degrades to `[]` rather than throwing either way.
 */
async function listOwnedPagesForBusiness(
  businessId: string,
  token: string,
  fetchImpl: FetchImpl = fetch,
  appSecret?: string,
): Promise<OwnedPage[]> {
  const proof = appSecret ? `&appsecret_proof=${createHmac('sha256', appSecret).update(token).digest('hex')}` : '';
  const url = `${GRAPH_BASE}/${GRAPH_VERSION}/${businessId}/owned_pages?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(token)}${proof}`;
  try {
    const res = await fetchImpl(url);
    const body = (await res.json().catch(() => undefined)) as { data?: OwnedPage[] } | undefined;
    return res.ok && Array.isArray(body?.data) ? (body.data as OwnedPage[]) : [];
  } catch {
    return [];
  }
}

function businessIdsFromDebugToken(data: DebugTokenData): string[] {
  return data.granular_scopes?.find((s) => s.scope === 'business_management')?.target_ids ?? [];
}

// ---------------------------------------------------------------------------
// OAuth exchange → connection
// ---------------------------------------------------------------------------

export type OAuthExchangeResult =
  | {
      ok: true;
      connectionId: string;
      pagesFound: number;
      igFound: number;
      adAccountsFound: number;
      pagePath: 'me/accounts' | 'owned_pages' | 'none';
    }
  | { ok: false; error: string };

/**
 * Exchange the OAuth `code`, debug the resulting token (scopes + expiry),
 * encrypt + upsert `meta_connections`, then enumerate + upsert assets.
 * `kind` is always `'flb'` — the schema's `'system_user'` kind is for a
 * future direct system-user-token override flow (out of scope this session).
 */
export async function createConnectionFromOAuth(
  ctx: CoreCtx,
  input: { code: string; redirectUri: string; connectedBy: string },
  opts: { fetchImpl?: FetchImpl } = {},
): Promise<OAuthExchangeResult> {
  const { appId, appSecret } = requireMetaEnv();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const graphOpts: GraphOpts = { fetchImpl };

  const exchange = await exchangeCodeForToken({ appId, appSecret, code: input.code, redirectUri: input.redirectUri }, graphOpts);
  if (!exchange.ok || !exchange.data?.access_token) {
    return { ok: false, error: exchange.error ?? 'token exchange failed' };
  }
  let accessToken = exchange.data.access_token;

  const debug = await debugToken(accessToken, appId, appSecret, fetchImpl);
  if (!debug.ok) return { ok: false, error: debug.error };

  // expires_at 0 (or absent) = never-expiring — the FLB "Core Manager" config's
  // business system-user token, per spec §5 LIVE FACTS. token_expires_at stays
  // null in that case; only call extendUserToken when Graph says it will lapse.
  let expiresAt: Date | null = debug.data.expires_at ? new Date(debug.data.expires_at * 1000) : null;
  if (expiresAt) {
    const extended = await extendUserToken({ appId, appSecret, shortToken: accessToken }, graphOpts);
    if (extended.ok && extended.data?.access_token) {
      accessToken = extended.data.access_token;
      expiresAt = extended.data.expires_in ? new Date(Date.now() + extended.data.expires_in * 1000) : expiresAt;
    }
  }

  const grantedScopes = debug.data.scopes ?? [];
  const fbUserId = debug.data.user_id ?? null;
  const { ciphertext, iv } = encrypt(accessToken);

  const connectionId = await withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .insert(metaConnections)
      .values({
        orgId: ctx.tenantId,
        kind: 'flb',
        fbUserId,
        tokenCiphertext: ciphertext,
        tokenIv: iv,
        tokenExpiresAt: expiresAt,
        grantedScopes,
        status: 'active',
        connectedBy: input.connectedBy,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [metaConnections.orgId, metaConnections.kind, metaConnections.fbUserId],
        set: {
          tokenCiphertext: ciphertext,
          tokenIv: iv,
          tokenExpiresAt: expiresAt,
          grantedScopes,
          status: 'active',
          connectedBy: input.connectedBy,
          updatedAt: new Date(),
        },
      })
      .returning({ id: metaConnections.id });
    return row.id;
  });

  const enumeration = await enumerateAndUpsertAssets(ctx, connectionId, accessToken, { fetchImpl });
  return {
    ok: true,
    connectionId,
    pagesFound: enumeration.pagesFound,
    igFound: enumeration.igFound,
    adAccountsFound: enumeration.adAccountsFound,
    pagePath: enumeration.pagePath,
  };
}

// ---------------------------------------------------------------------------
// Asset enumeration
// ---------------------------------------------------------------------------

export type EnumerationResult = {
  pagesFound: number;
  igFound: number;
  adAccountsFound: number;
  pagePath: 'me/accounts' | 'owned_pages' | 'none';
};

export async function enumerateAndUpsertAssets(
  ctx: CoreCtx,
  connectionId: string,
  userToken: string,
  opts: { fetchImpl?: FetchImpl } = {},
): Promise<EnumerationResult> {
  const { appId, appSecret } = requireMetaEnv();
  const fetchImpl = opts.fetchImpl ?? fetch;

  let pages: PageWithToken[] = [];
  let pagePath: EnumerationResult['pagePath'] = 'none';

  const primary = await listPagesWithTokens(userToken, { fetchImpl, appSecret });
  if (primary.ok && primary.data && primary.data.length > 0) {
    pages = primary.data;
    pagePath = 'me/accounts';
  } else {
    // No IG scopes are granted by this login config (spec §5 LIVE FACTS) so
    // instagram_business_account may simply be absent — tolerated below, not
    // an error. Empty *pages*, though, can mean the system-user token's
    // assignment lives at the business level; try the owned_pages fallback.
    const debug = await debugToken(userToken, appId, appSecret, fetchImpl);
    const businessIds = debug.ok ? businessIdsFromDebugToken(debug.data) : [];
    for (const businessId of businessIds) {
      const owned = await listOwnedPagesForBusiness(businessId, userToken, fetchImpl, appSecret);
      if (owned.length > 0) {
        pages = owned;
        pagePath = 'owned_pages';
        break;
      }
    }
  }

  const adAccountsRes = await listAdAccounts(userToken, { fetchImpl, appSecret });
  const adAccounts = adAccountsRes.ok ? (adAccountsRes.data ?? []) : [];

  let igFound = 0;
  await withOrgCore(ctx, async (tx) => {
    for (const page of pages) {
      const pageToken = page.access_token ? encrypt(page.access_token) : null;
      await tx
        .insert(metaAssets)
        .values({
          orgId: ctx.tenantId,
          connectionId,
          kind: 'page',
          externalId: page.id,
          name: page.name ?? null,
          pageTokenCiphertext: pageToken?.ciphertext ?? null,
          pageTokenIv: pageToken?.iv ?? null,
          meta: {},
        })
        .onConflictDoUpdate({
          target: [metaAssets.orgId, metaAssets.kind, metaAssets.externalId],
          set: {
            connectionId,
            name: page.name ?? null,
            pageTokenCiphertext: pageToken?.ciphertext ?? null,
            pageTokenIv: pageToken?.iv ?? null,
          },
        });

      // Tolerated: this login config grants no instagram_* scope, so this
      // field is normally absent (spec §5 LIVE FACTS) — only upsert when present.
      if (page.instagram_business_account?.id) {
        igFound++;
        await tx
          .insert(metaAssets)
          .values({
            orgId: ctx.tenantId,
            connectionId,
            kind: 'ig',
            externalId: page.instagram_business_account.id,
            name: page.instagram_business_account.username ?? null,
            parentPageId: page.id,
            meta: {},
          })
          .onConflictDoUpdate({
            target: [metaAssets.orgId, metaAssets.kind, metaAssets.externalId],
            set: {
              connectionId,
              name: page.instagram_business_account.username ?? null,
              parentPageId: page.id,
            },
          });
      }
    }

    for (const acct of adAccounts) {
      await tx
        .insert(metaAssets)
        .values({
          orgId: ctx.tenantId,
          connectionId,
          kind: 'ad_account',
          externalId: acct.id,
          name: acct.name ?? null,
          currency: acct.currency ?? null,
          meta: { account_status: acct.account_status ?? null },
        })
        .onConflictDoUpdate({
          target: [metaAssets.orgId, metaAssets.kind, metaAssets.externalId],
          set: { connectionId, name: acct.name ?? null, currency: acct.currency ?? null },
        });
    }
  });

  // Auto-register each connected page (and its IG account, if any) into the
  // org's CRM harvest scope, so Messenger/IG contacts get harvested without a
  // manual "Add account" step. No-op for orgs on the legacy (unconfigured)
  // scope — see ensureAccountInScope. Runs after the tx above commits (each
  // call opens its own withOrgCore transaction).
  for (const page of pages) {
    await ensureAccountInScope(ctx, 'messenger', page.id, page.name ?? null);
    if (page.instagram_business_account?.id) {
      await ensureAccountInScope(
        ctx,
        'instagram',
        page.instagram_business_account.id,
        page.instagram_business_account.username ?? null,
      );
    }
  }

  return { pagesFound: pages.length, igFound, adAccountsFound: adAccounts.length, pagePath };
}

// ---------------------------------------------------------------------------
// Instagram API with Instagram Login — a second, independent connect flow
// (spec 2026-07-05-instagram-login-integration). No page in the loop at all:
// the IG professional account authenticates directly, so there is exactly
// one asset (the IG user itself) and its token lives on the CONNECTION, not
// on any asset (mirroring how the FLB user token lives on
// `meta_connections.tokenCiphertext` above).
// ---------------------------------------------------------------------------

/** Best-effort `username` for a readable settings-page label — not returned by the token exchange. */
async function fetchIgUsername(igUserId: string, token: string, fetchImpl: FetchImpl): Promise<string | null> {
  try {
    const url = `https://graph.instagram.com/${igUserId}?fields=username&access_token=${encodeURIComponent(token)}`;
    const res = await fetchImpl(url);
    const body = (await res.json().catch(() => undefined)) as { username?: string } | undefined;
    return res.ok ? (body?.username ?? null) : null;
  } catch {
    return null;
  }
}

export type IgOAuthExchangeResult = { ok: true; connectionId: string } | { ok: false; error: string };

/**
 * Exchange the IG-Login OAuth `code` (short-lived → long-lived), encrypt +
 * upsert a `kind: 'ig_login'` connection, and upsert its single `kind: 'ig'`
 * asset (`parentPageId: null` — the discriminator the sync dispatcher uses to
 * tell an IG-Login asset apart from an FLB-discovered one, see
 * meta-sync.service.ts). `fbUserId` is repurposed to hold the IG user id for
 * this connection kind (ponytail: no schema change for one repurposed
 * column — rename only if a third auth family needs a clearer name).
 */
export async function createIgConnectionFromOAuth(
  ctx: CoreCtx,
  input: { code: string; redirectUri: string; connectedBy: string },
  opts: { fetchImpl?: FetchImpl } = {},
): Promise<IgOAuthExchangeResult> {
  const { igAppId, igAppSecret } = requireMetaIgEnv();
  const fetchImpl = opts.fetchImpl ?? fetch;

  const shortLived = await exchangeIgCodeForToken(
    { appId: igAppId, appSecret: igAppSecret, code: input.code, redirectUri: input.redirectUri },
    { fetchImpl },
  );
  if (!shortLived.ok || !shortLived.data?.access_token || !shortLived.data?.user_id) {
    return { ok: false, error: shortLived.error ?? 'token exchange failed' };
  }

  const longLived = await exchangeIgLongLivedToken(
    { appSecret: igAppSecret, shortToken: shortLived.data.access_token },
    { fetchImpl },
  );
  if (!longLived.ok || !longLived.data?.access_token) {
    return { ok: false, error: longLived.error ?? 'long-lived token exchange failed' };
  }

  const igUserId = shortLived.data.user_id;
  // Store the scopes IG ACTUALLY granted (from the short-lived token exchange's
  // `permissions`), not a hardcoded assumption — otherwise the settings UI and
  // any scope-gated feature (e.g. comments needs instagram_business_manage_comments)
  // can't tell what's really available, and a partial re-consent looks identical
  // to a full one. Falls back to basic if IG omits the field.
  const grantedScopes = shortLived.data.permissions?.length ? shortLived.data.permissions : ['instagram_business_basic'];
  // Unlike FLB's "0 = never expires" business system-user token, IG-Login
  // tokens always expire (~60 days) — expiresAt is always set here.
  const expiresAt = longLived.data.expires_in ? new Date(Date.now() + longLived.data.expires_in * 1000) : null;
  const { ciphertext, iv } = encrypt(longLived.data.access_token);
  const username = await fetchIgUsername(igUserId, longLived.data.access_token, fetchImpl);

  const connectionId = await withOrgCore(ctx, async (tx) => {
    const [row] = await tx
      .insert(metaConnections)
      .values({
        orgId: ctx.tenantId,
        kind: 'ig_login',
        fbUserId: igUserId,
        tokenCiphertext: ciphertext,
        tokenIv: iv,
        tokenExpiresAt: expiresAt,
        grantedScopes,
        status: 'active',
        connectedBy: input.connectedBy,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [metaConnections.orgId, metaConnections.kind, metaConnections.fbUserId],
        set: {
          tokenCiphertext: ciphertext,
          tokenIv: iv,
          tokenExpiresAt: expiresAt,
          grantedScopes,
          status: 'active',
          connectedBy: input.connectedBy,
          updatedAt: new Date(),
        },
      })
      .returning({ id: metaConnections.id });
    return row.id;
  });

  await withOrgCore(ctx, (tx) =>
    tx
      .insert(metaAssets)
      .values({
        orgId: ctx.tenantId,
        connectionId,
        kind: 'ig',
        externalId: igUserId,
        name: username,
        parentPageId: null,
        meta: {},
      })
      .onConflictDoUpdate({
        target: [metaAssets.orgId, metaAssets.kind, metaAssets.externalId],
        set: { connectionId, name: username, parentPageId: null },
      }),
  );

  // Same CRM harvest auto-registration the FLB path does for its IG assets.
  await ensureAccountInScope(ctx, 'instagram', igUserId, username);

  return { ok: true, connectionId };
}

// ---------------------------------------------------------------------------
// Org-scoped reads + mutations (settings UI, disconnect/toggle routes)
// ---------------------------------------------------------------------------

export function listConnections(ctx: CoreCtx): Promise<MetaConnection[]> {
  return withOrgCore(ctx, (tx) =>
    tx.select().from(metaConnections).where(eq(metaConnections.orgId, ctx.tenantId)).orderBy(desc(metaConnections.createdAt)),
  );
}

export function listAssets(ctx: CoreCtx, connectionId?: string): Promise<MetaAsset[]> {
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(metaAssets)
      .where(
        connectionId
          ? and(eq(metaAssets.orgId, ctx.tenantId), eq(metaAssets.connectionId, connectionId))
          : eq(metaAssets.orgId, ctx.tenantId),
      ),
  );
}

export async function toggleAsset(ctx: CoreCtx, assetId: string, enabled: boolean): Promise<boolean> {
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .update(metaAssets)
      .set({ enabled })
      .where(and(eq(metaAssets.id, assetId), eq(metaAssets.orgId, ctx.tenantId)))
      .returning({ id: metaAssets.id });
    return rows.length > 0;
  });
}

/** Disconnect: mark the connection revoked, keep the row + its assets/facts. */
export async function disconnect(ctx: CoreCtx, connectionId: string): Promise<boolean> {
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .update(metaConnections)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(and(eq(metaConnections.id, connectionId), eq(metaConnections.orgId, ctx.tenantId)))
      .returning({ id: metaConnections.id });
    return rows.length > 0;
  });
}

// ---------------------------------------------------------------------------
// Initial sync-job seeding (WP5 owns job processing; this just enqueues once)
// ---------------------------------------------------------------------------

const INITIAL_SYNC_KINDS = ['ads', 'posts', 'messages'] as const;
const INITIAL_BACKFILL_DAYS = 90;

/**
 * Seed the three initial sync jobs after a successful connect. Mirrors the
 * insert+catch-23505 idiom `finance-sync-jobs.service.ts` uses for its
 * partial-unique active-job index — Postgres won't let ON CONFLICT infer
 * against a partial index without repeating its WHERE, so "insert, ignore a
 * unique violation" is the same no-op in practice as ON CONFLICT DO NOTHING.
 */
export async function enqueueInitialSyncJobs(ctx: CoreCtx): Promise<void> {
  const since = new Date();
  since.setDate(since.getDate() - INITIAL_BACKFILL_DAYS);
  const sinceStr = since.toISOString().slice(0, 10);

  // ON CONFLICT DO NOTHING (not a per-iteration try/catch): a failed insert
  // aborts the whole tx in Postgres, so catching 23505 in JS still leaves the
  // next insert throwing "current transaction is aborted" — the exact bug that
  // 500'd the OAuth callback when a sync job was already queued. The partial
  // unique index (status in queued|running) is caught by the untargeted
  // ON CONFLICT, so an already-active kind is silently skipped. Same class as
  // the message-ledger poison-batch fix.
  await withOrgCore(ctx, async (tx) => {
    await tx
      .insert(metaSyncJobs)
      .values(INITIAL_SYNC_KINDS.map((kind) => ({ orgId: ctx.tenantId, kind, status: 'queued' as const, since: sinceStr })))
      .onConflictDoNothing();
  });
}
