#!/usr/bin/env bun
/**
 * One-off channel reconcile: push DB channel rules → gateway config.
 *
 * WHY THIS IS A SCRIPT, NOT A SERVICE
 * -----------------------------------
 * The DB→gateway direction is a *migration* concern: existing channels live in
 * the gateway's gateway.json and need to be brought under the DB once. Future
 * channels are created DB-native and applied to the gateway from the hub UI over
 * the browser's gateway WS connection (the same path the config editor uses) — so
 * the request-path service only needs the gateway→DB import. This script exists
 * for the one-time backfill / any future bulk reconcile run by an operator who
 * has gateway admin credentials (the hub server process does not).
 *
 * USAGE
 *   # 1. capture the current gateway config (config.get / the live gateway.json):
 *   #    ssh <gw> 'sudo cat ~bot-prd/.minion/gateway.json' > /tmp/gw.json
 *   # 2. dump the DB channels for the org (see channels-from-db.sql), e.g.:
 *   #    psql "$SUPABASE_DB_URL" -At -f scripts/channels-from-db.sql > /tmp/db.json
 *   bun scripts/reconcile-channels.ts --config /tmp/gw.json --db /tmp/db.json [--account +51...]
 *
 * Output: the JSON merge-patch(es) to feed `config.patch { raw, baseHash }`
 * (or apply by editing gateway.json — same hot-reload, no full restart). Prints
 * only; applying is intentionally a separate, deliberate step.
 */
import { readFileSync } from 'node:fs';

type ChannelType = 'whatsapp' | 'telegram' | 'discord';

interface ChannelRow {
  type: ChannelType;
  accountId: string;
  enabled: boolean;
  replies: 'none' | 'bound';
  allowFrom: string[];
  groupAllowFrom: string[];
  requireMention: boolean;
}
interface BindingRow {
  matchKind: 'catchall' | 'dm_peer' | 'group';
  matchPeer: string | null;
  agentId: string | null;
}
interface GatewayBinding {
  agentId?: string | null;
  match?: { channel?: string; accountId?: string; peer?: { kind?: string; id?: string } };
}

/**
 * Pure: DB channel row + bindings → gateway merge-patch. The bindings array has no
 * stable id, so a merge-patch REPLACES it — keep every other account's bindings and
 * swap this account's. replies='none' → single noAgent catchall (receive-only).
 */
export function buildGatewayChannelPatch(
  channel: ChannelRow,
  dbBindings: BindingRow[],
  currentBindings: GatewayBinding[],
) {
  const dmPolicy = channel.allowFrom.includes('*') ? 'open' : 'allowlist';
  const accountConfig = {
    enabled: channel.enabled,
    dmPolicy,
    allowFrom: channel.allowFrom,
    groupAllowFrom: channel.groupAllowFrom,
    groups: { '*': { requireMention: channel.requireMention } },
  };
  const noAgentCatchall: GatewayBinding = {
    agentId: null,
    match: { channel: channel.type, accountId: channel.accountId },
  };
  let accountBindings: GatewayBinding[];
  if (channel.replies === 'none') {
    accountBindings = [noAgentCatchall];
  } else {
    accountBindings = dbBindings.map((b) => ({
      agentId: b.agentId,
      match: {
        channel: channel.type,
        accountId: channel.accountId,
        ...(b.matchPeer
          ? { peer: { kind: b.matchKind === 'group' ? 'group' : 'direct', id: b.matchPeer } }
          : {}),
      },
    }));
    if (accountBindings.length === 0) accountBindings = [noAgentCatchall];
  }
  const others = currentBindings.filter(
    (b) => !(b.match?.channel === channel.type && b.match?.accountId === channel.accountId),
  );
  return {
    channels: { [channel.type]: { accounts: { [channel.accountId]: accountConfig } } },
    bindings: [...others, ...accountBindings],
  };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const configPath = arg('--config');
  const dbPath = arg('--db');
  const only = arg('--account');
  if (!configPath || !dbPath) {
    console.error('usage: reconcile-channels.ts --config <gateway.json> --db <channels.json> [--account +51...]');
    process.exit(1);
  }
  const gw = JSON.parse(readFileSync(configPath, 'utf8'));
  const currentBindings: GatewayBinding[] = gw.bindings ?? [];
  // db.json: [{ channel: ChannelRow, bindings: BindingRow[] }, ...]
  const dbRows: Array<{ channel: ChannelRow; bindings: BindingRow[] }> = JSON.parse(
    readFileSync(dbPath, 'utf8'),
  );

  for (const { channel, bindings } of dbRows) {
    if (only && channel.accountId !== only) continue;
    const patch = buildGatewayChannelPatch(channel, bindings, currentBindings);
    console.log(`\n# ${channel.type}/${channel.accountId} (replies=${channel.replies})`);
    console.log(JSON.stringify(patch, null, 2));
  }
}

if (import.meta.main) main();
