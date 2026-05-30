<script lang="ts">
  import PluginIframe from '$lib/plugins/PluginIframe.svelte';
  import type { Theme } from '$lib/plugins/bridge-protocol';
  import { hostsState, fetchHostToken } from '$lib/state/features/hosts.svelte';
  import { PageHeader } from '$lib/components/ui';
  import { Puzzle } from 'lucide-svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

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

<div class="flex h-full min-h-0 flex-col">
  <PageHeader title={data.entry.title} subtitle={data.entry.description ?? undefined}>
    {#snippet leading()}
      <Puzzle size={16} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>
  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if tokenLoading}
      <div class="px-6 py-6 text-sm text-muted-foreground">Authenticating…</div>
    {:else if tokenError}
      <div class="px-6 py-6 text-sm text-destructive">Auth: {tokenError}</div>
    {:else if !authToken}
      <div class="px-6 py-6 text-sm text-muted-foreground">
        No active host. Pick one in the host switcher to load this plugin.
      </div>
    {:else}
      {#key data.entry.pluginId + ':' + data.entry.entrypoint}
        <PluginIframe
          pluginId={data.entry.pluginId}
          entrypoint={data.entry.entrypoint}
          gatewayUrl={data.gatewayBaseUrl}
          {authToken}
          {theme}
          {tokens}
        />
      {/key}
    {/if}
  </div>
</div>
