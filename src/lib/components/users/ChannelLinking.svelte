<script lang="ts">
  import { onMount } from 'svelte';
  import { invalidate } from '$app/navigation';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { hostsState } from '$lib/state/features/hosts.svelte';
  import { toastError, toastSuccess } from '$lib/state/ui/toast.svelte';
  import WhatsAppQrPairing from '$lib/components/channels/WhatsAppQrPairing.svelte';
  import WhatsAppClaimCard from '$lib/components/users/WhatsAppClaimCard.svelte';
  import TelegramClaimCard from '$lib/components/users/TelegramClaimCard.svelte';
  import PluginSlotHost from '$lib/plugins/PluginSlotHost.svelte';
  import type { Theme } from '$lib/plugins/bridge-protocol';
  import type { ChannelPluginInfo } from '$lib/types/channel-link';
  import { Plug, RefreshCw, Settings as SettingsIcon, ChevronDown } from 'lucide-svelte';
  import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
  import { BRAND_ICON_SET, PLUGIN_ICON_MAP } from '$lib/plugins/icon-map';
  import { Puzzle } from 'lucide-svelte';

  type Identity = {
    id: string;
    source?: 'turso' | 'supabase';
    provider: string;
    kind: 'oauth' | 'channel';
    externalId: string;
    displayName: string | null;
    verifiedAt: number | null;
  };

  let { userId, identities }: { userId: string; identities: Identity[] } = $props();

  const channelIdentities = $derived(identities.filter((i) => i.kind === 'channel'));

  // WhatsApp + Telegram get dedicated connect cards (OTP / deep-link). The card
  // itself shows the connected identity, so there is no separate linked list.
  const whatsappIdentity = $derived(channelIdentities.find((i) => i.provider === 'whatsapp') ?? null);
  const telegramIdentity = $derived(channelIdentities.find((i) => i.provider === 'telegram') ?? null);
  const serverId = $derived(hostsState.activeHostId ?? '');

  function isClaimChannel(p: ChannelPluginInfo): boolean {
    const hay = `${p.pluginId} ${p.icon ?? ''} ${p.label}`.toLowerCase();
    return hay.includes('whatsapp') || hay.includes('telegram');
  }

  function resolveChannelIcon(icon?: string) {
    if (!icon) return Puzzle;
    if (BRAND_ICON_SET.has(icon)) return null; // use ChannelBrandIcon
    if (PLUGIN_ICON_MAP[icon]) return PLUGIN_ICON_MAP[icon];
    return Puzzle;
  }

  // Compact theme/token snapshot for plugin iframes (only used by `iframe`
  // mode descriptors). Read once — making it reactive would tear down the bridge.
  // svelte-ignore non_reactive_update
  let iframeTheme: Theme = 'light';
  let iframeTokens: Record<string, string> = {};
  if (typeof document !== 'undefined') {
    iframeTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    for (const name of Array.from(document.documentElement.style)) {
      if (name.startsWith('--')) iframeTokens[name] = document.documentElement.style.getPropertyValue(name).trim();
    }
  }

  let plugins = $state<ChannelPluginInfo[]>([]);
  let loading = $state(false);
  let loadError = $state<string | null>(null);
  let openPluginId = $state<string | null>(null);

  // Everything except WhatsApp/Telegram, which have dedicated connect cards.
  const otherPlugins = $derived(plugins.filter((p) => !isClaimChannel(p)));

  // Per-plugin form state for `mode: 'form'` descriptors.
  let formValues = $state<Record<string, Record<string, string>>>({});
  let submitting = $state<string | null>(null);

  async function loadPlugins() {
    if (!conn.connected) return;
    loading = true;
    loadError = null;
    try {
      const res = (await sendRequest('channels.plugins.list', {})) as { plugins?: ChannelPluginInfo[] } | null;
      plugins = res?.plugins ?? [];
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load channel plugins';
    } finally {
      loading = false;
    }
  }

  onMount(loadPlugins);
  // Reload whenever a gateway connection comes up.
  $effect(() => {
    if (conn.connected && plugins.length === 0 && !loading) loadPlugins();
  });

  async function disconnect(identity: Identity) {
    const label = identity.provider.charAt(0).toUpperCase() + identity.provider.slice(1);
    if (!confirm(`Disconnect ${label}?`)) return;
    const qs = identity.source ? `?source=${identity.source}` : '';
    const res = await fetch(`/api/users/${userId}/identities/${identity.id}${qs}`, { method: 'DELETE' });
    if (res.ok) {
      toastSuccess(`${label} disconnected`);
      await invalidate('app:identities');
    } else {
      toastError('Disconnect failed');
    }
  }

  function toggle(pluginId: string) {
    openPluginId = openPluginId === pluginId ? null : pluginId;
  }

  function fieldVal(pluginId: string, key: string): string {
    return formValues[pluginId]?.[key] ?? '';
  }
  function setFieldVal(pluginId: string, key: string, value: string) {
    formValues[pluginId] = { ...(formValues[pluginId] ?? {}), [key]: value };
  }

  async function submitForm(p: ChannelPluginInfo) {
    if (p.link.mode !== 'form') return;
    submitting = p.pluginId;
    try {
      await sendRequest(p.link.submitMethod, formValues[p.pluginId] ?? {});
      toastSuccess(`${p.label} connected`);
      formValues[p.pluginId] = {};
      openPluginId = null;
      await invalidate('app:identities');
    } catch (e) {
      toastError(e instanceof Error ? e.message : 'Connect failed');
    } finally {
      submitting = null;
    }
  }
</script>

<div class="bg-bg2 border border-border rounded-md overflow-hidden">
  <div class="flex items-center justify-between px-3 py-2.5 border-b border-border">
    <div class="text-[10px] uppercase tracking-wider text-muted font-semibold">Channels</div>
    {#if conn.connected}
      <button
        class="flex items-center gap-1 text-[10px] text-muted hover:text-foreground bg-transparent border-none cursor-pointer"
        onclick={loadPlugins}
        title="Refresh"
      >
        <RefreshCw size={11} class={loading ? 'animate-spin' : ''} /> Refresh
      </button>
    {/if}
  </div>

  <!-- One row per channel. Each card shows its own connected state + manage
       controls, so there is no separate "linked channels" list. -->
  <div class="divide-y divide-border/60">
    <WhatsAppClaimCard {userId} {serverId} identity={whatsappIdentity} onDisconnect={disconnect} />
    <TelegramClaimCard {userId} identity={telegramIdentity} onDisconnect={disconnect} />

    {#if conn.connected}
      {#each otherPlugins as p (p.pluginId)}
        {@const isOpen = openPluginId === p.pluginId}
        <div>
          <button
            class="w-full flex items-center gap-3 px-3 py-2.5 bg-transparent hover:bg-bg3/30 transition-colors cursor-pointer border-none text-left"
            onclick={() => toggle(p.pluginId)}
          >
            <span class="shrink-0">
              {#if p.icon && BRAND_ICON_SET.has(p.icon)}
                <ChannelBrandIcon channel={p.icon} class="h-4 w-4" />
              {:else}
                {@const IconComp = resolveChannelIcon(p.icon)}
                <IconComp class="h-4 w-4" />
              {/if}
            </span>
            <span class="flex-1 min-w-0">
              <span class="block text-sm text-foreground">{p.label}</span>
              {#if p.description}<span class="block text-[11px] text-muted-foreground truncate">{p.description}</span>{/if}
            </span>
            <span class="text-[11px] text-muted-foreground shrink-0">Connect</span>
            <ChevronDown size={14} class="text-muted shrink-0 transition-transform {isOpen ? 'rotate-180' : ''}" />
          </button>

          {#if isOpen}
            <div class="px-3 pb-3 pt-1">
              {#if p.link.mode === 'qr'}
                <WhatsAppQrPairing
                  channelId="pending"
                  serverId={hostsState.activeHostId ?? ''}
                  onpaired={async () => { await invalidate('app:identities'); }}
                />
              {:else if p.link.mode === 'form'}
                <div class="space-y-2">
                  {#each p.link.fields as f (f.key)}
                    <input
                      type={f.type === 'password' ? 'password' : 'text'}
                      placeholder={f.placeholder ?? f.label}
                      value={fieldVal(p.pluginId, f.key)}
                      oninput={(e) => setFieldVal(p.pluginId, f.key, (e.currentTarget as HTMLInputElement).value)}
                      class="w-full bg-bg border border-border rounded px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-strong focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  {/each}
                  <button
                    class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-accent text-accent-foreground border-none cursor-pointer hover:opacity-90 disabled:opacity-50"
                    onclick={() => submitForm(p)}
                    disabled={submitting === p.pluginId}
                  >
                    <Plug size={12} /> {p.link.submitLabel ?? `Connect ${p.label}`}
                  </button>
                </div>
              {:else if p.link.mode === 'iframe'}
                <div class="h-[420px]">
                  <PluginSlotHost
                    slot="settings.plugins"
                    theme={iframeTheme}
                    tokens={iframeTokens}
                    entries={[{
                      pluginId: p.pluginId,
                      slot: 'settings.plugins',
                      title: p.label,
                      description: p.description ?? '',
                      entrypoint: p.link.entrypoint,
                    }]}
                  />
                </div>
              {:else}
                <!-- managed -->
                <p class="text-xs text-muted-foreground mb-2">{p.link.note ?? 'This channel is configured on the gateway.'}</p>
                {#if p.link.settingsHref}
                  <a
                    href={p.link.settingsHref}
                    class="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-transparent border border-border text-foreground hover:bg-muted/30 no-underline"
                  >
                    <SettingsIcon size={12} /> Open settings
                  </a>
                {/if}
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <!-- Footnotes -->
  {#if !conn.connected}
    <p class="text-[11px] text-muted-strong px-3 py-2.5 border-t border-border/60">Connect to a gateway to link more channels.</p>
  {:else if loadError}
    <p class="text-[11px] text-destructive px-3 py-2.5 border-t border-border/60">{loadError}</p>
  {/if}
</div>
