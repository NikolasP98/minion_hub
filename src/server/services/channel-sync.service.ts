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
import { gatewayCallAsUser } from '$lib/server/gateway-rpc';
import type { ServerCtx } from '$server/auth/core-ctx';

type ChannelType = 'whatsapp' | 'telegram' | 'discord';
const CHANNEL_TYPES: ChannelType[] = ['whatsapp', 'telegram', 'discord'];

interface GatewayAccount {
  name?: string;
  enabled?: boolean;
  dmPolicy?: string;
  allowFrom?: string[];
  groupAllowFrom?: string[];
  groups?: Record<string, { requireMention?: boolean }>;
}
interface GatewayBinding {
  agentId?: string | null;
  match?: { channel?: string; accountId?: string; peer?: { kind?: string; id?: string } };
}
interface GatewayConfig {
  channels?: Record<string, { accounts?: Record<string, GatewayAccount> }> & {
    accountOrgs?: Record<string, Record<string, string[]>>;
  };
  bindings?: GatewayBinding[];
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
    const accounts = config.channels?.[type]?.accounts ?? {};
    for (const [accountId, acc] of Object.entries(accounts)) {
      const orgIds = accountOrgs[type]?.[accountId] ?? [];
      if (!orgIds.includes(tenantId)) {
        continue; // not this org's account
      }
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
      out.push({
        channel: {
          type,
          accountId,
          label: acc.name?.trim() || accountId,
          enabled: acc.enabled !== false,
          replies,
          allowFrom: acc.allowFrom ?? [],
          groupAllowFrom: acc.groupAllowFrom ?? [],
          requireMention: acc.groups?.['*']?.requireMention ?? true,
          status: acc.enabled === false ? 'inactive' : 'active',
        },
        bindings: bindingRows,
      });
    }
  }
  return out;
}

/**
 * Import the gateway's accounts for the acting org into the DB (idempotent upsert on
 * (tenant_id, gateway_id, type, account_id)). Returns the number of channels synced.
 */
export async function importGatewayChannels(ctx: ServerCtx): Promise<{ imported: number }> {
  const config = await gatewayCallAsUser<GatewayConfig>('config.get', {}, ctx.profileId, { timeoutMs: 5000 });
  const rows = gatewayConfigToChannelRows(config, ctx.tenantId);

  await withOrgCore(ctx, async (tx) => {
    for (const { channel, bindings: bRows } of rows) {
      const [upserted] = await tx
        .insert(channels)
        .values({
          id: newId(),
          tenantId: ctx.tenantId,
          gatewayId: ctx.gatewayId,
          type: channel.type,
          accountId: channel.accountId,
          label: channel.label,
          status: channel.status,
          enabled: channel.enabled,
          replies: channel.replies,
          allowFrom: channel.allowFrom,
          groupAllowFrom: channel.groupAllowFrom,
          requireMention: channel.requireMention,
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
            updatedAt: new Date(),
          },
        })
        .returning({ id: channels.id });

      // Replace this channel's bindings (read-modify-write is unnecessary — bindings
      // are per-channel via FK, so just clear + reinsert this channel's rows).
      if (upserted) {
        await tx.delete(channelBindings).where(eq(channelBindings.channelId, upserted.id));
        if (bRows.length > 0) {
          await tx.insert(channelBindings).values(
            bRows.map((b) => ({
              tenantId: ctx.tenantId,
              channelId: upserted.id,
              matchKind: b.matchKind,
              matchPeer: b.matchPeer,
              agentId: b.agentId,
            })),
          );
        }
      }
    }
  });

  return { imported: rows.length };
}
