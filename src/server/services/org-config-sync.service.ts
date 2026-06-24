/**
 * DB-authoritative org config → gateway sync.
 *
 * Two org-scoped maps used to live in the gateway file but are really the org's
 * data, not the box's: `channels.accountOrgs` (which orgs own a channel account)
 * and `plugins.orgDisabled` (which orgs turned a plugin off). The DB now owns
 * both; the gateway file is a derived cache. `reconcileOrgConfig` rebuilds the
 * two maps from the DB and pushes them to the gateway via `config.patch` — so a
 * fresh-disk gateway redeploy recovers org state, and the gateway's hot-path
 * enforcement (which still reads them synchronously from in-memory config) is
 * left completely untouched.
 *
 * Sources of truth:
 *  - accountOrgs ← PG-core `channels` rows (one per org that owns the account).
 *  - orgDisabled ← `plugin_org_disabled` rows with disabled=true.
 *
 * The cross-org read is a gateway-admin/infra operation: it MUST see every org's
 * rows for one gateway, so it uses `getCoreDb()` (postgres, RLS-bypass) filtered
 * strictly by gateway_id — never a per-user surface. Per-org WRITES elsewhere go
 * through `withOrgCore` (RLS enforced) so a toggle only touches its own org.
 */
import { eq } from 'drizzle-orm';
import { channels } from '@minion-stack/db/pg';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import { pluginOrgDisabled } from '$server/db/pg-plugin-org-schema';
import { gatewayCall } from '$lib/server/gateway-rpc';

type ChannelType = 'discord' | 'whatsapp' | 'telegram';

export type AccountOrgsMap = Record<string, Record<string, string[]>>;
export type OrgDisabledMap = Record<string, string[]>;

const uniqSorted = (xs: string[]): string[] => [...new Set(xs)].sort();

/**
 * `config.get` returns a ConfigFileSnapshot `{ config, hash, … }` — the actual
 * config lives at `.config`, NOT the top level. Reading the wrapper directly
 * (e.g. `snapshot.channels`) silently yields undefined. Unwrap defensively in
 * case a caller already passed the bare config.
 */
export function unwrapConfigSnapshot<T = Record<string, unknown>>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'config' in raw) {
    return ((raw as { config?: T }).config ?? {}) as T; // {config:null} on invalid → {}
  }
  return (raw ?? {}) as T;
}

/** Pure: PG-core channel rows → `accountOrgs[type][accountId] = [orgId,…]`. */
export function buildAccountOrgs(
  rows: { type: ChannelType; accountId: string | null; tenantId: string }[],
): AccountOrgsMap {
  const acc: Record<string, Record<string, string[]>> = {};
  for (const r of rows) {
    const accountId = r.accountId?.trim();
    if (!accountId) continue; // unlinked/legacy row — no account key to scope
    (acc[r.type] ??= {})[accountId] = [...(acc[r.type][accountId] ?? []), r.tenantId];
  }
  for (const type of Object.keys(acc)) {
    for (const accountId of Object.keys(acc[type])) {
      acc[type][accountId] = uniqSorted(acc[type][accountId]);
    }
  }
  return acc;
}

/** Pure: disable rows → `orgDisabled[pluginId] = [orgId,…]` (only disabled=true). */
export function buildPluginOrgDisabled(
  rows: { pluginId: string; orgId: string; disabled: boolean }[],
): OrgDisabledMap {
  const acc: Record<string, string[]> = {};
  for (const r of rows) {
    if (!r.disabled) continue;
    acc[r.pluginId] = [...(acc[r.pluginId] ?? []), r.orgId];
  }
  for (const pluginId of Object.keys(acc)) acc[pluginId] = uniqSorted(acc[pluginId]);
  return acc;
}

/**
 * Authoritative replace under merge-patch semantics. config.patch MERGES objects
 * (and deletes a key when its value is null), so to make the gateway's map EQUAL
 * `next` we emit `next` plus an explicit `null` for every key present on the
 * gateway (`current`) but absent from `next`. Without this, a re-enabled plugin
 * or unlinked account would linger on the gateway = an org-isolation leak.
 */
export function replaceFlat(
  current: Record<string, unknown>,
  next: Record<string, string[]>,
): Record<string, string[] | null> {
  const patch: Record<string, string[] | null> = { ...next };
  for (const key of Object.keys(current ?? {})) {
    if (!(key in next)) patch[key] = null;
  }
  return patch;
}

/** Two-level authoritative replace (accountOrgs: type → accountId → orgId[]). */
export function replaceNested(
  current: Record<string, Record<string, unknown>>,
  next: AccountOrgsMap,
): Record<string, Record<string, string[] | null> | null> {
  const patch: Record<string, Record<string, string[] | null> | null> = {};
  for (const type of new Set([...Object.keys(current ?? {}), ...Object.keys(next)])) {
    if (!(type in next)) {
      patch[type] = null; // whole channel type gone from DB
      continue;
    }
    patch[type] = replaceFlat(current?.[type] ?? {}, next[type]);
  }
  return patch;
}

/**
 * Rebuild both org maps from the DB for one gateway and push them to the gateway
 * file so the gateway's copy becomes EQUAL to the DB (authoritative replace, see
 * `replaceFlat`). Reads the gateway's current maps to compute deletions. Returns
 * the maps for logging/tests. Admin/infra only — the caller must gate access.
 *
 * ponytail: single-gateway deploy — `gatewayCall` targets the configured gateway
 * via system creds. For multi-gateway routing, thread per-gateway creds here.
 */
export async function reconcileOrgConfig(gatewayId: string): Promise<{
  accountOrgs: AccountOrgsMap;
  orgDisabled: OrgDisabledMap;
}> {
  const db = getCoreDb(); // postgres / RLS-bypass — gateway-filtered cross-org read
  const [channelRows, disabledRows] = await Promise.all([
    db
      .select({ type: channels.type, accountId: channels.accountId, tenantId: channels.tenantId })
      .from(channels)
      .where(eq(channels.gatewayId, gatewayId)),
    db
      .select({
        pluginId: pluginOrgDisabled.pluginId,
        orgId: pluginOrgDisabled.orgId,
        disabled: pluginOrgDisabled.disabled,
      })
      .from(pluginOrgDisabled)
      .where(eq(pluginOrgDisabled.gatewayId, gatewayId)),
  ]);

  const accountOrgs = buildAccountOrgs(channelRows as never);
  const orgDisabled = buildPluginOrgDisabled(disabledRows);

  // config.patch enforces optimistic concurrency: baseHash must equal the gateway's
  // CURRENT snapshot, else it rejects with "…re-run config.get and retry". A
  // concurrent gateway.json writer between our config.get and config.patch loses
  // ~40% of the time, so retry: re-fetch the snapshot (fresh hash + current maps)
  // and re-patch. DB-derived maps are stable across attempts; only `cur`/`hash` move.
  let lastErr: unknown;
  for (let attempt = 0; attempt < RECONCILE_MAX_ATTEMPTS; attempt += 1) {
    const snap =
      (await gatewayCall<{ config?: GatewayMaps; hash?: string } & GatewayMaps>('config.get', {})) ??
      {};
    const cur = unwrapConfigSnapshot<GatewayMaps>(snap);
    const curOrgDisabled = (cur.plugins?.orgDisabled ?? {}) as Record<string, unknown>;
    const curAccountOrgs = (cur.channels?.accountOrgs ?? {}) as Record<
      string,
      Record<string, unknown>
    >;

    // Safety valve (org isolation): an EMPTY DB view for a gateway that still has
    // org-scoping is the signature of reconciling the wrong gateway / an
    // incomplete DB — authoritative-replace would null out every account's scope
    // (= all accounts become globally visible). Never wipe a populated gateway
    // from nothing; the real "org removed its last account" case leaves the
    // gateway already empty, so this only blocks the dangerous anomaly.
    if (isDangerousEmptyWipe(accountOrgs, orgDisabled, curAccountOrgs, curOrgDisabled)) {
      console.warn(
        '[org-config] refusing to wipe populated gateway from empty DB view',
        gatewayId,
      );
      return { accountOrgs, orgDisabled };
    }

    try {
      await gatewayCall('config.patch', {
        raw: JSON.stringify({
          channels: { accountOrgs: replaceNested(curAccountOrgs, accountOrgs) },
          plugins: { orgDisabled: replaceFlat(curOrgDisabled, orgDisabled) },
        }),
        baseHash: snap.hash,
        note: 'reconcileOrgConfig: DB-authoritative org maps',
      });
      return { accountOrgs, orgDisabled };
    } catch (e) {
      lastErr = e;
      // Only the baseHash race is retryable. Anything else (network, invalid
      // config) is real — surface it now instead of burning retries.
      if (!isBaseHashRace(e)) throw e;
    }
  }
  throw lastErr;
}

const RECONCILE_MAX_ATTEMPTS = 4;

/** The gateway rejects a stale baseHash with "…re-run config.get and retry"
 *  (both the missing-hash and changed-since-load cases). That's our retry signal. */
export function isBaseHashRace(e: unknown): boolean {
  return /re-run config\.get and retry/i.test(String((e as Error)?.message ?? e));
}

/** True when the DB-derived maps are BOTH empty yet the gateway still has org
 *  scoping — pushing would null every account's scope (org-isolation loss). The
 *  signature of reconciling the wrong gateway / an incomplete DB, not a real
 *  "org removed its last account" (which leaves the gateway already empty). */
export function isDangerousEmptyWipe(
  accountOrgs: AccountOrgsMap,
  orgDisabled: OrgDisabledMap,
  curAccountOrgs: Record<string, unknown>,
  curOrgDisabled: Record<string, unknown>,
): boolean {
  const dbEmpty = !Object.keys(accountOrgs).length && !Object.keys(orgDisabled).length;
  const gatewayPopulated =
    !!Object.keys(curAccountOrgs).length || !!Object.keys(curOrgDisabled).length;
  return dbEmpty && gatewayPopulated;
}

/**
 * Fire-and-forget reconcile for inline use after a channel mutation: pushes the
 * fresh org maps to the gateway immediately (no waiting for the hourly tick) but
 * never fails the caller — the DB is the source of truth, so a transient gateway
 * error just means the next tick reconciles. Logs and swallows.
 */
export async function reconcileOrgConfigSafe(gatewayId: string): Promise<void> {
  try {
    await reconcileOrgConfig(gatewayId);
  } catch (e) {
    console.error('[org-config] inline reconcile failed for gateway', gatewayId, e);
  }
}

type GatewayMaps = {
  plugins?: { orgDisabled?: Record<string, unknown> };
  channels?: { accountOrgs?: Record<string, Record<string, unknown>> };
};

/** Per-org write of a single plugin's disable state. RLS-enforced (own org only). */
export async function setPluginDisabledForOrg(
  ctx: { db: ReturnType<typeof getCoreDb>; tenantId: string },
  gatewayId: string,
  pluginId: string,
  disabled: boolean,
): Promise<void> {
  await withOrgCore(ctx, (tx) =>
    tx
      .insert(pluginOrgDisabled)
      .values({ orgId: ctx.tenantId, gatewayId, pluginId, disabled, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [pluginOrgDisabled.orgId, pluginOrgDisabled.gatewayId, pluginOrgDisabled.pluginId],
        set: { disabled, updatedAt: new Date() },
      }),
  );
}
