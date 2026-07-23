/**
 * Assignment lease + health-aware balancer (spec 2026-07-19 §D4 / §WP-F).
 *
 * A human picks the CHANNEL; this module picks the INSTANCE. `(org, channel)`
 * resolves to exactly one instance, server-side, and every protocol (HTTP, RPC,
 * WS) follows that single answer. The client never picks — the browser using an
 * explicitly selected host while the server independently guessed is what
 * produced a full day of intermittency, and `daf64d23`'s deterministic ordering
 * was the stopgap this replaces.
 *
 * Three invariants, in priority order:
 *
 * 1. FAIL CLOSED on authorization. An org with no row for a channel resolves to
 *    `null`, always. Health has nothing to do with this.
 * 2. SINGLE WRITER. The gateway is single-writer per org (SQLite + Baileys WA
 *    sessions on a local volume); two instances serving one org corrupts its
 *    channel state. The lease row IS the mutex — persisted, never inferred from
 *    a health-check race. Acquisition is a conditional upsert that only wins
 *    against an expired incumbent, so concurrent resolvers converge on one row.
 * 3. FAIL OPEN on health, loudly. If nothing probes healthy we still return the
 *    lease holder, flagged `healthy: false`, rather than blanking the app on a
 *    transient. Availability degrades visibly; authorization never does.
 *
 * Health is proven by a REAL WS UPGRADE, never by `/health` 200 — the
 * Cloudflare route in front of netcup's `default` service served `{"ok":true}`
 * for weeks while refusing upgrades, and that is exactly the failure this must
 * detect.
 *
 * OUT OF SCOPE (spec §F7): state replication. Flipping the lease restores
 * SERVICE, not SESSIONS — the org's WhatsApp pairing stays on the old host.
 * `ResolvedEndpoint.stateMoved` is always false and the UI must say so; a silent
 * partial recovery is worse than an honest error.
 */
import { WebSocket } from 'ws';
import { sql } from 'drizzle-orm';
import { getCoreDb } from '$server/db/pg-client';
import {
  listChannelCandidates,
  type ChannelCandidate,
  type GatewayChannel,
} from './gateway.pg.service';

/** How long a lease stays valid without renewal. Long enough that the common
 *  path is a single indexed read; short enough that a dead holder frees up
 *  without operator action. A failed probe expires the lease immediately, so
 *  this is the ceiling on unattended failover, not the expected latency. */
const LEASE_TTL_SECONDS = 300;

/** WS upgrade probe budget. Above a couple of seconds a "slow" instance is
 *  indistinguishable from a down one for a user staring at a spinner. */
const PROBE_TIMEOUT_MS = 4000;

export interface ResolvedEndpoint {
  gatewayId: string;
  /** Legacy server id — what `/api/servers/[id]/*` and the browser key by. */
  serverId: string;
  name: string;
  url: string;
  channel: GatewayChannel;
  /** Last probe verdict for the lease holder. `null` = never probed. */
  healthy: boolean | null;
  /** Always false — see §F7. Kept explicit so the UI cannot forget to say it. */
  stateMoved: false;
}

function toEndpoint(
  c: ChannelCandidate,
  channel: GatewayChannel,
  healthy: boolean | null,
): ResolvedEndpoint {
  return {
    gatewayId: c.gatewayId,
    serverId: c.serverId,
    name: c.name,
    url: c.url,
    channel,
    healthy,
    stateMoved: false,
  };
}

/**
 * Prove an instance is alive by completing a REAL WebSocket upgrade.
 *
 * An HTTP 200 on `/health` proves only that something answered — the broken
 * Cloudflare route passed that check for weeks. We do not send a `connect`
 * frame or authenticate: the upgrade itself is the thing `/health` cannot fake,
 * and a handshake would need the token to be valid as well, conflating "this
 * instance is down" with "this token is wrong".
 */
export async function probeWsUpgrade(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  const wsUrl = url.startsWith('http') ? url.replace(/^http/, 'ws') : url;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      resolve(ok);
    };
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl, { handshakeTimeout: timeoutMs });
    } catch {
      return resolve(false);
    }
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.on('open', () => finish(true));
    socket.on('error', () => finish(false));
    socket.on('close', () => finish(false));
  });
}

interface LeaseRow {
  gatewayId: string;
  live: boolean;
  healthy: boolean | null;
}

/**
 * Read the persisted lease. Returns `null` both when there is no lease and when
 * `gateway_lease` does not exist yet (pre-migration) — the caller then falls
 * back to deterministic ordering, which is exactly today's behavior, so this
 * module can ship ahead of its migration without 500ing every consumer.
 */
async function readLease(orgId: string, channel: GatewayChannel): Promise<LeaseRow | null> {
  try {
    const res = await getCoreDb().execute(sql`
      select gateway_id::text as gateway_id,
             (expires_at > now()) as live,
             (last_healthy_at is not null and last_healthy_at > now() - interval '1 hour') as healthy
        from public.gateway_lease
       where org_id = ${orgId}::uuid and channel = ${channel}
       limit 1
    `);
    const row = (res as unknown as { rows?: Record<string, unknown>[] }).rows?.[0] ?? null;
    if (!row) return null;
    return {
      gatewayId: String(row.gateway_id),
      live: row.live === true,
      healthy: typeof row.healthy === 'boolean' ? row.healthy : null,
    };
  } catch (err) {
    console.warn('[gateway-lease] read failed (pre-migration?), falling back to ordering', err);
    return null;
  }
}

/**
 * Take the `(org, channel)` lease for `gatewayId` — the single-writer mutex.
 *
 * The `where` clause is the whole point: the upsert only overwrites an EXPIRED
 * incumbent, or renews the lease it already holds. A concurrent resolver that
 * loses the race gets zero rows back and re-reads rather than stealing, so two
 * instances are never handed the same `(org, channel)`.
 *
 * Returns the gateway id that actually holds the lease afterwards (which may be
 * someone else's, if we lost), or `null` when the table isn't there yet.
 */
async function acquireLease(
  orgId: string,
  channel: GatewayChannel,
  gatewayId: string,
  healthy: boolean | null,
): Promise<string | null> {
  try {
    const res = await getCoreDb().execute(sql`
      insert into public.gateway_lease (org_id, channel, gateway_id, expires_at, last_healthy_at)
      values (
        ${orgId}::uuid, ${channel}, ${gatewayId}::uuid,
        now() + ${`${LEASE_TTL_SECONDS} seconds`}::interval,
        ${healthy === true ? sql`now()` : sql`null`}
      )
      on conflict (org_id, channel) do update
         set gateway_id      = excluded.gateway_id,
             acquired_at     = case when public.gateway_lease.gateway_id = excluded.gateway_id
                                    then public.gateway_lease.acquired_at else now() end,
             expires_at      = excluded.expires_at,
             last_healthy_at = coalesce(excluded.last_healthy_at, public.gateway_lease.last_healthy_at)
       where public.gateway_lease.expires_at <= now()
          or public.gateway_lease.gateway_id = excluded.gateway_id
      returning gateway_id::text as gateway_id
    `);
    const row = (res as unknown as { rows?: Record<string, unknown>[] }).rows?.[0] ?? null;
    if (row) return String(row.gateway_id);
    // Lost the race to a live lease on a different instance — respect it.
    return (await readLease(orgId, channel))?.gatewayId ?? null;
  } catch (err) {
    console.warn('[gateway-lease] acquire failed (pre-migration?)', err);
    return null;
  }
}

/** Expire the lease so the next resolver may take it. Scoped to `gatewayId` so
 *  a stale caller cannot release a lease that has already moved on. */
async function expireLease(
  orgId: string,
  channel: GatewayChannel,
  gatewayId: string,
): Promise<void> {
  try {
    await getCoreDb().execute(sql`
      update public.gateway_lease set expires_at = now()
       where org_id = ${orgId}::uuid and channel = ${channel} and gateway_id = ${gatewayId}::uuid
    `);
  } catch (err) {
    console.warn('[gateway-lease] expire failed (pre-migration?)', err);
  }
}

/**
 * The read path: `(org, channel) → one instance`, DB-only, no network.
 *
 * Deliberately does NOT probe. This runs on the `(app)` layout load for every
 * navigation; a WS upgrade per request would put seconds on every page. Probing
 * happens in `revalidateChannelLease` — on connect failure and on a timer —
 * which is what §F2 asks for.
 *
 * Returns `null` when the org has no row for the channel. That is the
 * fail-closed answer, not an error condition.
 */
async function pickChannelHolder(
  orgId: string | null,
  channel: GatewayChannel,
): Promise<{ candidate: ChannelCandidate; healthy: boolean | null } | null> {
  if (!orgId) return null;
  const candidates = await listChannelCandidates(orgId, channel);
  if (!candidates.length) return null;

  const lease = await readLease(orgId, channel);
  if (lease?.live) {
    const held = candidates.find((c) => c.gatewayId === lease.gatewayId);
    // A lease pointing at a row the org no longer has is stale, not authority.
    if (held) return { candidate: held, healthy: lease.healthy };
  }

  // `candidates` is ordered (created_at, id) by `listChannelCandidates` — a
  // total order, so two rows sharing a `created_at` still pick the same one on
  // every request. Without the id clause this fell to Postgres heap order.
  const taken = await acquireLease(orgId, channel, candidates[0].gatewayId, null);
  const winner = (taken && candidates.find((c) => c.gatewayId === taken)) || candidates[0];
  return { candidate: winner, healthy: lease?.healthy ?? null };
}

export async function resolveChannelEndpoint(
  orgId: string | null,
  channel: GatewayChannel,
): Promise<ResolvedEndpoint | null> {
  const held = await pickChannelHolder(orgId, channel);
  return held && toEndpoint(held.candidate, channel, held.healthy);
}

/**
 * `(org, channel) → the credentials to talk to it`. THE authority for
 * server-side gateway RPC (spec §D4: a human picks the CHANNEL, the system
 * picks the INSTANCE), and the same lease the browser's endpoint comes from —
 * so HTTP, RPC and WS cannot disagree about which box serves an org.
 *
 * Replaces `getOrgAssignedGatewayCredentials(orgId)`, which was channel-blind
 * and, once every switchable org had a dev row too, could hand a server-side
 * RPC the DEV gateway on a `created_at` tie.
 *
 * Fail closed: an org with no row for `channel` gets `null` and the caller
 * falls through its own chain — it never silently borrows another channel.
 */
export async function resolveOrgChannelCredentials(
  orgId: string | null,
  channel: GatewayChannel,
): Promise<{ url: string; token: string } | null> {
  const held = await pickChannelHolder(orgId, channel);
  return held && { url: held.candidate.url, token: held.candidate.token };
}

/**
 * The write path: probe, and flip the lease if the holder is dead.
 *
 * Called on connect failure and from a timer tick — never inline on a page
 * load. Probes the current holder first (the common case is "it's fine, renew");
 * only on failure does it expire the lease and walk the remaining candidates.
 *
 * Failover restores SERVICE, not SESSIONS (§F7). The returned endpoint always
 * carries `stateMoved: false`; callers must surface that rather than presenting
 * a clean recovery.
 */
export async function revalidateChannelLease(
  orgId: string | null,
  channel: GatewayChannel,
): Promise<ResolvedEndpoint | null> {
  if (!orgId) return null;
  const candidates = await listChannelCandidates(orgId, channel);
  if (!candidates.length) return null;

  const lease = await readLease(orgId, channel);
  const holder = lease?.live
    ? (candidates.find((c) => c.gatewayId === lease.gatewayId) ?? null)
    : null;

  if (holder) {
    if (await probeWsUpgrade(holder.url)) {
      await acquireLease(orgId, channel, holder.gatewayId, true);
      return toEndpoint(holder, channel, true);
    }
    // Dead holder. Expiring the lease is what makes it stealable — the mutex is
    // never bypassed, only released.
    await expireLease(orgId, channel, holder.gatewayId);
  }

  for (const c of candidates) {
    if (holder && c.gatewayId === holder.gatewayId) continue;
    if (!(await probeWsUpgrade(c.url))) continue;
    const taken = await acquireLease(orgId, channel, c.gatewayId, true);
    const winner = (taken && candidates.find((x) => x.gatewayId === taken)) || c;
    return toEndpoint(winner, channel, true);
  }

  // Nothing healthy. Fail OPEN on health (invariant 3): hand back the holder (or
  // the first candidate) marked unhealthy so the UI can say "DEV is down"
  // instead of "you have no gateways", which would read as a permissions bug.
  return toEndpoint(holder ?? candidates[0], channel, false);
}
