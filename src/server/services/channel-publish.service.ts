/**
 * Tracer-bullet (ticket P1-T0) — publish ONE whatsapp account's resolved projection
 * to Valkey at the raw key the gateway's `cacheGet` reads, then fire the existing
 * cache-invalidate broadcast tagged with that key as the change signal. This proves
 * the DB→gateway live loop (DB write → HttpBroadcaster POST → gateway mirror refresh
 * → compare) on a single safe account, observe-only.
 *
 * Deliberate scope (ponytail):
 *  - ONE gateway in prod → no gatewayId in the key (no collision); add it when a
 *    second gateway exists.
 *  - RAW ioredis write, NOT the namespaced `@minion-stack/cache` facade — the facade
 *    namespaces keys (`hub:v…:`) and wraps values in a CacheEntry envelope, neither
 *    of which the gateway's plain-JSON `cacheGet` can read. Plain `JSON.stringify`
 *    at the agreed key keeps both sides in lockstep.
 *  - The change SIGNAL reuses `invalidateTags` (→ in-prod HttpBroadcaster → gateway
 *    `/events/cache-invalidate`); no shared-contract change.
 *
 * See specs/2026-06-26-gateway-config-db-migration-plan.md (Phase 1 tracer).
 */
import { invalidateTags } from '@minion-stack/cache';
import { and, eq } from 'drizzle-orm';
import { channels } from '@minion-stack/db/pg';
import { env } from '$env/dynamic/private';
import { withOrgCore } from '$server/db/with-org-core';
import type { ServerCtx } from '$server/auth/core-ctx';

/** 30 min — a DB-write-then-Valkey-write gap self-heals by expiry (consensus M1). */
const TTL_MS = 30 * 60 * 1000;

/** The single source of truth for the key both sides compute. type:accountId, no
 *  gatewayId (single-gateway tracer). The gateway derives the identical string from
 *  the broadcast tag. */
export function channelKey(type: string, accountId: string): string {
  return `channel:${type}:${accountId}`;
}

/** The minimal resolved projection compared on both sides. STRICT allowlist — never
 *  spread the row: `config.get`/credentials must not leak into Valkey (consensus M2). */
export interface ChannelProjection {
  enabled: boolean;
  allowFrom: string[];
  groupAllowFrom: string[];
  requireMention: boolean;
  replies: 'none' | 'bound';
  /** Allowlisted transport knobs (P1-T2 backfill); never secrets. */
  settings: Record<string, unknown>;
  /** Creds POINTER (whatsapp: `whatsapp/<accountId>`; else null). Never the creds. */
  authRef: string | null;
}

export function projectChannelRow(row: {
  enabled: boolean;
  allowFrom: string[] | null;
  groupAllowFrom: string[] | null;
  requireMention: boolean;
  replies: string;
  settings?: unknown;
  authRef?: string | null;
}): ChannelProjection {
  return {
    enabled: row.enabled,
    allowFrom: row.allowFrom ?? [],
    groupAllowFrom: row.groupAllowFrom ?? [],
    requireMention: row.requireMention,
    replies: row.replies === 'bound' ? 'bound' : 'none',
    settings:
      row.settings && typeof row.settings === 'object'
        ? (row.settings as Record<string, unknown>)
        : {},
    authRef: row.authRef ?? null,
  };
}

/** A channels-table row reduced to the fields the hydration endpoint reads. */
export interface ChannelRowLite {
  type: string;
  accountId: string | null;
  enabled: boolean;
  allowFrom: string[] | null;
  groupAllowFrom: string[] | null;
  requireMention: boolean;
  replies: string;
  settings?: unknown;
  authRef?: string | null;
  /** Owning org (channels.tenant_id) — the DB source of accountOrgs for P4. */
  tenantId?: string;
  /** Set => account is USER-scoped (follows this person across orgs); null/absent
   *  => ORG-scoped via tenantId (P0 classification primitive, channel-scoping-fix §3). */
  ownerProfileId?: string | null;
}
export interface HydrationItem {
  accountId: string;
  type: string;
  /** Owning org id — the gateway derives accountOrgs[type][accountId] from this (P4). */
  orgId: string | null;
  /** Set => USER-scoped account (visible to this profile in every org); null =>
   *  classify by orgId instead. Additive — P0 carries the class, no enforcement yet. */
  ownerProfileId: string | null;
  projection: ChannelProjection;
}

/** The channel types the gateway mirror covers (P3-T1: all three, not whatsapp-only). */
const HYDRATABLE_TYPES = new Set(['whatsapp', 'telegram', 'discord']);

/** Pure: rows → hydration items for the gateway pull. All migrated channel types,
 *  account-keyed; allowlisted projection (settings/authRef pointer — never secrets).
 *  Shared by the /api/internal/channels/resolved route. */
export function toResolvedChannels(rows: ChannelRowLite[]): HydrationItem[] {
  return rows
    .filter(
      (r): r is ChannelRowLite & { accountId: string } =>
        HYDRATABLE_TYPES.has(r.type) && typeof r.accountId === 'string' && r.accountId.length > 0,
    )
    .map((r) => ({
      accountId: r.accountId,
      type: r.type,
      orgId: r.tenantId ?? null,
      ownerProfileId: r.ownerProfileId ?? null,
      projection: projectChannelRow(r),
    }));
}

// Lazy raw Valkey client (mirrors the gateway's ttl-cache pattern). Best-effort:
// no client → publish silently no-ops (the signal still fires via invalidateTags).
type RawRedis = { set(k: string, v: string, mode: string, ttl: number): Promise<unknown> };
let redisP: Promise<RawRedis | null> | null = null;
function rawValkey(): Promise<RawRedis | null> {
  if (redisP) return redisP;
  redisP = (async () => {
    const url = env.VALKEY_URL?.trim();
    if (!url) return null;
    try {
      const mod = (await import('ioredis')) as unknown as {
        default: new (url: string, opts?: unknown) => RawRedis;
      };
      return new mod.default(url, {
        password: env.VALKEY_PASSWORD?.trim() || undefined,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
    } catch {
      return null;
    }
  })();
  return redisP;
}

/** Migrated channel types whose mutations should signal the gateway to re-hydrate. */
const SIGNAL_TYPES = new Set(['whatsapp', 'telegram', 'discord']);

/**
 * Read the channel row by id and broadcast the change signal so the gateway re-pulls
 * its mirror (the signal triggers a full re-hydrate, so any migrated-type edit
 * propagates — needed post-P3-flip so a hub toggle/edit reaches the runtime). The
 * Valkey projection write stays whatsapp-only (vestigial tracer cache). Self-gating
 * (no accountId / non-migrated type → no-op); callers fire it unconditionally.
 */
export async function publishChannel(ctx: ServerCtx, channelId: string): Promise<void> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .select({
        type: channels.type,
        accountId: channels.accountId,
        enabled: channels.enabled,
        allowFrom: channels.allowFrom,
        groupAllowFrom: channels.groupAllowFrom,
        requireMention: channels.requireMention,
        replies: channels.replies,
      })
      .from(channels)
      .where(
        and(
          eq(channels.id, channelId),
          eq(channels.tenantId, ctx.tenantId),
          eq(channels.gatewayId, ctx.gatewayId),
        ),
      ),
  );
  // Any migrated, account-keyed channel signals; only whatsapp also warms Valkey.
  if (!row || !SIGNAL_TYPES.has(row.type) || !row.accountId) return;

  const key = channelKey(row.type, row.accountId);
  if (row.type === 'whatsapp') {
    const redis = await rawValkey();
    if (redis) {
      try {
        await redis.set(key, JSON.stringify(projectChannelRow(row)), 'PX', TTL_MS);
      } catch {
        // best-effort — the signal below still fires; gateway re-pulls on it
      }
    }
  }
  // Change signal → existing HttpBroadcaster → gateway /events/cache-invalidate →
  // gateway re-hydrates the whole mirror (so the edit reaches the runtime post-flip).
  await invalidateTags([key]);
}

/**
 * Fire the change signal for a known type+accountId WITHOUT reading the row — for the
 * delete path, where the row is already gone so `publishChannel` would no-op. The
 * gateway re-hydrates its whole mirror on the signal, dropping the deleted account
 * (and, with CHANNEL_RUNTIME_APPLY, restarting that channel type). Self-gates to
 * migrated, account-keyed types. Best-effort.
 */
export async function signalChannelChange(type: string, accountId: string): Promise<void> {
  if (!SIGNAL_TYPES.has(type) || !accountId) return;
  await invalidateTags([channelKey(type, accountId)]);
}
