<script lang="ts">
  import PluginIframe from '$lib/plugins/PluginIframe.svelte';
  import type { Theme } from '$lib/plugins/bridge-protocol';
  import type { PluginUiManifestOccupant } from '$lib/plugins/plugin-types';
  import { hostsState, fetchHostToken } from '$lib/state/features/hosts.svelte';
  import { PageHeader } from '$lib/components/ui';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';
  import { Puzzle } from 'lucide-svelte';
  import { BRAND_ICON_SET, PLUGIN_ICON_MAP } from '$lib/plugins/icon-map';
  import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';
  import * as m from '$lib/paraglide/messages';

  let { entry, gatewayBaseUrl }: { entry: PluginUiManifestOccupant; gatewayBaseUrl: string } =
    $props();

  // Snapshot the hub theme + every CSS custom property declared on :root so
  // plugin iframes can inherit the live design tokens. Plain `let` — values
  // are read once when PluginIframe mounts.
  // svelte-ignore non_reactive_update
  let theme: Theme = 'light';
  let tokens: Record<string, string> = {};
  if (typeof document !== 'undefined') {
    theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    const root = document.documentElement;
    const computed = getComputedStyle(root);
    for (const name of Array.from(root.style)) {
      if (name.startsWith('--')) tokens[name] = root.style.getPropertyValue(name).trim();
    }
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSStyleRule)) continue;
        if (!/^:root\b/.test(rule.selectorText)) continue;
        for (const name of Array.from(rule.style)) {
          if (name.startsWith('--') && !(name in tokens))
            tokens[name] = computed.getPropertyValue(name).trim();
        }
      }
    }
  }

  let authToken = $state('');
  let tokenLoading = $state(false);
  let tokenError = $state<string | null>(null);

  $effect(() => {
    const hostId = hostsState.activeHostId;
    if (!hostId) {
      authToken = '';
      return;
    }
    tokenLoading = true;
    tokenError = null;
    fetchHostToken(hostId)
      .then((tok) => {
        if (tok === null) {
          tokenError = 'session required';
          authToken = '';
        } else {
          authToken = tok;
        }
      })
      .catch((err) => {
        tokenError = String(err);
        authToken = '';
      })
      .finally(() => {
        tokenLoading = false;
      });
  });
</script>

<PageShell archetype="workspace" scroll="none" labelledBy="plugin-control-title">
  <PageHeader
    titleId="plugin-control-title"
    title={entry.title}
    subtitle={entry.description ?? undefined}
    sticky={false}
  >
    {#snippet leading()}
      {#if entry.icon && BRAND_ICON_SET.has(entry.icon)}
        <ChannelBrandIcon channel={entry.icon} size={16} class="text-accent shrink-0" />
      {:else if entry.icon && PLUGIN_ICON_MAP[entry.icon]}
        {@const IconComp = PLUGIN_ICON_MAP[entry.icon]}
        <IconComp size={16} class="text-accent shrink-0" />
      {:else}
        <Puzzle size={16} class="text-accent shrink-0" />
      {/if}
    {/snippet}
  </PageHeader>
  <PageBody padding="none" scroll="none">
    <AsyncBoundary
      class="h-full"
      state={tokenLoading
        ? { kind: 'loading', label: m.common_loading() }
        : tokenError
          ? { kind: 'error', description: tokenError }
          : !authToken
            ? {
                kind: 'unavailable',
                title: m.config_noServer(),
                description: m.config_connectHint(),
              }
            : { kind: 'ready' }}
    >
      {#key entry.pluginId + ':' + entry.entrypoint}
        <PluginIframe
          pluginId={entry.pluginId}
          entrypoint={entry.entrypoint}
          gatewayUrl={gatewayBaseUrl}
          {authToken}
          {theme}
          {tokens}
          compat={entry.compat}
          pluginStatus={entry.status}
          fillContainer
        />
      {/key}
    </AsyncBoundary>
  </PageBody>
</PageShell>
