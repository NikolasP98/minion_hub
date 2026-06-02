// Shared channel data sources for the flow editor's channel-aware nodes
// (Channel Trigger + Channel output). Centralises the gateway/hub fetches so
// both config panels read the SAME dropdown data and we don't fan out duplicate
// `channels.status` / identity requests per node.
//
// Three sources:
//  • plugins     — `channels.plugins.list` (which channels exist)
//  • accounts    — `channels.status` → channelAccounts[channel] (linked sender accounts)
//  • identities  — GET /api/channels/identities (users who linked a channel to their hub account)
//
// All are lazy + cached for the session; callers invoke the `ensure*` loaders
// (typically from a `$effect`) and read via the accessor functions, which stay
// reactive because the backing store is `$state`.

import { sendRequest } from '$lib/services/gateway.svelte';
import { conn } from '$lib/state/gateway';

export type ChannelPlugin = { id: string; label: string };
export type ChannelAccount = {
  accountId: string;
  label: string;
  isDefault: boolean;
  linked: boolean;
  connected: boolean;
};
export type RegisteredIdentity = {
  id: string;
  channel: string;
  to: string;
  label: string;
  verified: boolean;
};

const FALLBACK_PLUGINS: ChannelPlugin[] = [
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'discord', label: 'Discord' },
];

const store = $state({
  plugins: FALLBACK_PLUGINS as ChannelPlugin[],
  pluginsLoaded: false,
  accountsByChannel: {} as Record<string, ChannelAccount[]>,
  defaultByChannel: {} as Record<string, string>,
  statusLoaded: false,
  identities: [] as RegisteredIdentity[],
  identitiesLoaded: false,
});

// ── Plugins ──────────────────────────────────────────────────────────────────
export function channelPlugins(): ChannelPlugin[] {
  return store.plugins;
}

export async function ensureChannelPlugins(): Promise<void> {
  if (store.pluginsLoaded || !conn.connected) return;
  try {
    const res = (await sendRequest('channels.plugins.list', {})) as
      | { plugins?: { channelType?: string; pluginId?: string; label?: string }[] }
      | null;
    const items = (res?.plugins ?? [])
      .map((p) => ({
        id: p.channelType ?? p.pluginId ?? '',
        label: p.label ?? p.channelType ?? p.pluginId ?? '',
      }))
      .filter((c) => c.id);
    if (items.length > 0) store.plugins = items;
    store.pluginsLoaded = true;
  } catch {
    // keep fallback list; allow a later retry
  }
}

// ── Accounts (from channels.status) ──────────────────────────────────────────
interface AccountSnapshot {
  accountId?: string;
  name?: string;
  linked?: boolean;
  connected?: boolean;
}

export async function ensureChannelStatus(): Promise<void> {
  if (store.statusLoaded || !conn.connected) return;
  try {
    const res = (await sendRequest('channels.status', {})) as
      | {
          channelAccounts?: Record<string, AccountSnapshot[]>;
          channelDefaultAccountId?: Record<string, string>;
        }
      | null;
    const byChannel: Record<string, ChannelAccount[]> = {};
    const defaults = res?.channelDefaultAccountId ?? {};
    for (const [channel, accounts] of Object.entries(res?.channelAccounts ?? {})) {
      byChannel[channel] = (accounts ?? [])
        .filter((a) => a && a.accountId)
        .map((a) => ({
          accountId: a.accountId!,
          label: a.name?.trim() || a.accountId!,
          isDefault: a.accountId === defaults[channel],
          linked: a.linked !== false,
          connected: a.connected === true,
        }));
    }
    store.accountsByChannel = byChannel;
    store.defaultByChannel = defaults;
    store.statusLoaded = true;
  } catch {
    // gateway may lack channels.status — accounts stay empty, UI falls back
  }
}

export function accountsFor(channel: string): ChannelAccount[] {
  return store.accountsByChannel[channel] ?? [];
}

export function defaultAccountFor(channel: string): string | undefined {
  return store.defaultByChannel[channel];
}

// ── Registered identities (user ↔ channel links) ─────────────────────────────
export async function ensureRegisteredIdentities(): Promise<void> {
  if (store.identitiesLoaded) return;
  try {
    const res = await fetch('/api/channels/identities');
    if (!res.ok) return;
    const body = (await res.json()) as {
      identities?: { id: string; channel: string; to: string; displayName?: string | null; verified?: boolean }[];
    };
    store.identities = (body.identities ?? []).map((i) => ({
      id: i.id,
      channel: i.channel,
      to: i.to,
      label: i.displayName?.trim() || i.to,
      verified: !!i.verified,
    }));
    store.identitiesLoaded = true;
  } catch {
    // leave empty; picker degrades to custom entry
  }
}

export function identitiesFor(channel: string): RegisteredIdentity[] {
  return store.identities.filter((i) => i.channel === channel);
}
