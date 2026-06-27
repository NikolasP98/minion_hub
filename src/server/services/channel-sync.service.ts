/**
 * Channel DB-sourcing (#3). Two directions:
 *  - importGatewayChannels: gateway `config.get` -> upsert `channels` + `channel_bindings`
 *    so the DB becomes a real registry of the gateway's accounts (keyed by account_id).
 *  - (write-back lives in the reconciler; this file owns the gw->DB import + the pure
 *    translation both directions share).
 *
 * See specs/2026-06-19-linked-channels-config-restructure.md.
 */
import { and, eq } from 'drizzle-orm';
import { channels, channelBindings } from '@minion-stack/db/pg';
import { newId } from '$server/db/utils';
import { withOrgCore } from '$server/db/with-org-core';
import { getCoreDb } from '$server/db/pg-client';
import { gatewayCall, gatewayCallAsUser } from '$lib/server/gateway-rpc';
import { unwrapConfigSnapshot, reconcileOrgConfigSafe } from './org-config-sync.service';
import type { ServerCtx } from '$server/auth/core-ctx';

type ChannelType = 'whatsapp' | 'telegram' | 'discord';
const CHANNEL_TYPES: ChannelType[] = ['whatsapp', 'telegram', 'discord'];

interface GatewayAccount {
  name?: string;
  enabled?: boolean;
  dmPolicy?: string;
  allowFrom?: Array<string | number>;
  groupAllowFrom?: Array<string | number>;
  groups?: Record<string, { requireMention?: boolean }>;
  // Transport knobs + secrets live here too; read ONLY via the SETTINGS_KEYS pick.
  [key: string]: unknown;
}
/** Root channel-type config = the per-account shape plus the `accounts` map. */
type GatewayChannelTypeConfig = GatewayAccount & { accounts?: Record<string, GatewayAccount> };
interface GatewayBinding {
  agentId?: string | null;
  match?: { channel?: string; accountId?: string; peer?: { kind?: string; id?: string } };
}
interface GatewayConfig {
  channels?: Record<string, GatewayChannelTypeConfig> & {
    accountOrgs?: Record<string, Record<string, string[]>>;
  };
  bindings?: GatewayBinding[];
}

/**
 * Per-account transport knobs the gateway reads per-message (the spec's "B" set +
 * audit-surfaced extras). STRICT allowlist: settings is built by PICKING these keys,
 * never by spreading the account — so `botToken`/`token`/`accessToken`/`authDir` can
 * never leak into the DB/Valkey (consensus M2). A key absent on a type is just omitted.
 */
const SETTINGS_KEYS = [
  // whatsapp
  'debounceMs',
  'sendReadReceipts',
  'selfChatMode',
  'mediaMaxMb',
  'messagePrefix',
  'textChunkLimit',
  'chunkMode',
  'blockStreaming',
  'ackReaction',
  // telegram
  'block',
  'allowed',
  'blockEmojiReactions',
] as const;

/** Pick the allowlisted transport knobs from a resolved account (never the secrets). */
function extractSettings(merged: GatewayAccount): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of SETTINGS_KEYS) {
    if (merged[k] !== undefined) out[k] = merged[k];
  }
  return out;
}

export interface ChannelRow {
  type: ChannelType;
  accountId: string;
  label: string;
  enabled: boolean;
  replies: 'none' | 'bound';
  allowFrom: string[];
  groupAllowFrom: string[];
  requireMention: boolean;
  status: 'active' | 'inactive';
  /** Explicit creds pointer (whatsapp: `whatsapp/<accountId>`; else null). Never creds. */
  authRef: string | null;
  /** Allowlisted transport knobs (resolved). */
  settings: Record<string, unknown>;
}
export interface BindingRow {
  matchKind: 'catchall' | 'dm_peer' | 'group';
  matchPeer: string | null;
  agentId: string | null;
}

/**
 * Pure translation: gateway config -> the channel rows + per-account bindings for a
 * single org. Only accounts mapped to `tenantId` via channels.accountOrgs are returned
 * (the gateway is multi-tenant; each org owns a subset of accounts).
 */
export function gatewayConfigToChannelRows(
  config: GatewayConfig,
  tenantId: string,
): Array<{ channel: ChannelRow; bindings: BindingRow[] }> {
  const out: Array<{ channel: ChannelRow; bindings: BindingRow[] }> = [];
  const accountOrgs = config.channels?.accountOrgs ?? {};
  const bindings = config.bindings ?? [];

  for (const type of CHANNEL_TYPES) {
    const typeCfg = config.channels?.[type];
    const accounts = typeCfg?.accounts ?? {};
    // Root channel-type defaults the gateway resolvers fall through to
    // (resolveWhatsAppAccount: `acc.X ?? root.X`; mergeTelegramAccountConfig:
    // `{...root, ...acc}`). Both reduce to this shallow merge for the fields below.
    const { accounts: _drop, ...rootDefaults } = typeCfg ?? {};
    for (const [accountId, acc] of Object.entries(accounts)) {
      const orgIds = accountOrgs[type]?.[accountId] ?? [];
      if (!orgIds.includes(tenantId)) {
        continue; // not this org's account
      }
      // ★ Resolve, don't read raw (consensus C1): merge root-level defaults so an
      // account relying on `channels.<type>.allowFrom` doesn't land as [] (→ silent
      // DM block). open ⟺ allowFrom contains '*', so an open account backfills ['*'].
      const merged: GatewayAccount = { ...rootDefaults, ...acc };
      const accBindings = bindings.filter(
        (b) => b.match?.channel === type && b.match?.accountId === accountId,
      );
      const bindingRows: BindingRow[] = accBindings.map((b) => ({
        matchKind: b.match?.peer?.id ? (b.match.peer.kind === 'group' ? 'group' : 'dm_peer') : 'catchall',
        matchPeer: b.match?.peer?.id ?? null,
        agentId: b.agentId ?? null,
      }));
      // replies = 'bound' if any binding routes to a real agent; else 'none' (noAgent).
      const replies: 'none' | 'bound' = accBindings.some((b) => b.agentId != null)
        ? 'bound'
        : 'none';
      const enabled = merged.enabled !== false;
      const allowFrom =
        merged.dmPolicy === 'open' ? ['*'] : (merged.allowFrom ?? []).map(String);
      out.push({
        channel: {
          type,
          accountId,
          label: merged.name?.trim() || accountId,
          enabled,
          replies,
          allowFrom,
          groupAllowFrom: (merged.groupAllowFrom ?? []).map(String),
          requireMention: merged.groups?.['*']?.requireMention ?? true,
          status: enabled ? 'active' : 'inactive',
          // whatsapp creds live on disk by accountId; telegram/discord tokens are
          // inline secrets (no disk dir) → no pointer. Never the creds themselves.
          authRef: type === 'whatsapp' ? `whatsapp/${accountId}` : null,
          settings: extractSettings(merged),
        },
        bindings: bindingRows,
      });
    }
  }
  return out;
}

/** Upsert one org's resolved channel rows (+ replace their bindings). Shared by the
 *  acting-org import (RLS tx) and the all-orgs backfill (RLS-bypass getCoreDb). The
 *  caller supplies the db/tx and the org id; tenant_id is written explicitly so the
 *  cross-org backfill can write rows for an org other than the connection's. */
async function writeChannelRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  tenantId: string,
  gatewayId: string,
  rows: Array<{ channel: ChannelRow; bindings: BindingRow[] }>,
): Promise<void> {
  for (const { channel, bindings: bRows } of rows) {
    const [upserted] = await tx
      .insert(channels)
      .values({
        id: newId(),
        tenantId,
        gatewayId,
        type: channel.type,
        accountId: channel.accountId,
        label: channel.label,
        status: channel.status,
        enabled: channel.enabled,
        replies: channel.replies,
        allowFrom: channel.allowFrom,
        groupAllowFrom: channel.groupAllowFrom,
        requireMention: channel.requireMention,
        authRef: channel.authRef,
        settings: channel.settings,
      })
      .onConflictDoUpdate({
        target: [channels.tenantId, channels.gatewayId, channels.type, channels.accountId],
        set: {
          label: channel.label,
          status: channel.status,
          enabled: channel.enabled,
          replies: channel.replies,
          allowFrom: channel.allowFrom,
          groupAllowFrom: channel.groupAllowFrom,
          requireMention: channel.requireMention,
          authRef: channel.authRef,
          settings: channel.settings,
          updatedAt: new Date(),
        },
      })
      .returning({ id: channels.id });

    // Replace this channel's bindings (per-channel via FK → clear + reinsert).
    if (upserted) {
      await tx.delete(channelBindings).where(eq(channelBindings.channelId, upserted.id));
      if (bRows.length > 0) {
        await tx.insert(channelBindings).values(
          bRows.map((b) => ({
            tenantId,
            channelId: upserted.id,
            matchKind: b.matchKind,
            matchPeer: b.matchPeer,
            agentId: b.agentId,
          })),
        );
      }
    }
  }
}

/**
 * Import the gateway's accounts for the acting org into the DB (idempotent upsert on
 * (tenant_id, gateway_id, type, account_id)). Returns the number of channels synced.
 */
export async function importGatewayChannels(ctx: ServerCtx): Promise<{ imported: number }> {
  // config.get returns a ConfigFileSnapshot { config, hash, … } — the config is
  // nested under `.config`, so unwrap before reading channels/accountOrgs.
  const snap = await gatewayCallAsUser<{ config?: GatewayConfig } & GatewayConfig>(
    'config.get',
    {},
    ctx.profileId,
    { timeoutMs: 5000 },
  );
  const config = unwrapConfigSnapshot<GatewayConfig>(snap);
  const rows = gatewayConfigToChannelRows(config, ctx.tenantId);

  await withOrgCore(ctx, (tx) => writeChannelRows(tx, ctx.tenantId, ctx.gatewayId, rows));

  // Org→account ownership just changed in the DB — push it to the gateway now
  // instead of waiting for the hourly tick (matters for multi-tenant isolation).
  await reconcileOrgConfigSafe(ctx.gatewayId);

  return { imported: rows.length };
}

/** Collect every org id referenced by any account in channels.accountOrgs. */
function allOrgIds(config: GatewayConfig): string[] {
  const orgs = new Set<string>();
  const accountOrgs = config.channels?.accountOrgs ?? {};
  for (const type of CHANNEL_TYPES) {
    for (const list of Object.values(accountOrgs[type] ?? {})) {
      for (const o of list ?? []) orgs.add(o);
    }
  }
  return [...orgs];
}

/**
 * All-orgs backfill (consensus M4): import EVERY org's accounts on a gateway into the
 * DB in one pass, not just the acting org. Reads the gateway config once (system creds
 * — `config.get` returns the whole file regardless of caller; org filtering happens in
 * `gatewayConfigToChannelRows`), then writes each org's rows via `getCoreDb`
 * (RLS-bypass, cross-org). DB-only — does NOT mirror-push to gateway.json. Idempotent.
 */
export async function backfillAllGatewayChannels(
  gatewayId: string,
): Promise<{ orgs: number; imported: number; byOrg: Record<string, number> }> {
  const snap = await gatewayCall<{ config?: GatewayConfig } & GatewayConfig>(
    'config.get',
    {},
    { timeoutMs: 5000 },
  );
  const config = unwrapConfigSnapshot<GatewayConfig>(snap);
  const db = getCoreDb();
  const byOrg: Record<string, number> = {};
  let imported = 0;
  for (const org of allOrgIds(config)) {
    const rows = gatewayConfigToChannelRows(config, org);
    await writeChannelRows(db, org, gatewayId, rows);
    byOrg[org] = rows.length;
    imported += rows.length;
  }
  return { orgs: Object.keys(byOrg).length, imported, byOrg };
}
