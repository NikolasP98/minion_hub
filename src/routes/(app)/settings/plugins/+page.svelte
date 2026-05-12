<script lang="ts">
  import { goto } from '$app/navigation';
  import PluginSlotHost from '$lib/plugins/PluginSlotHost.svelte';
  import SettingsTabBar from '$lib/components/settings/SettingsTabBar.svelte';
  import type { Theme } from '$lib/plugins/bridge-protocol';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  function selectTab(id: string) {
    goto(`/settings?s=${id}`);
  }

  // MVP: pick up theme mode from the document root and forward a tiny token
  // bag. The full theme/preset wiring lands in Phase B alongside the first
  // consumer plugin. (TODO: subscribe to theme changes via the theme rune
  // store and forward via PluginSlotHost.)
  const theme: Theme = 'light';
  const tokens: Record<string, string> = {};
</script>

<SettingsTabBar activeTab="" onselect={selectTab} />

<section class="space-y-4 p-6">
  <header>
    <h1 class="text-2xl font-semibold">Plugins</h1>
    <p class="text-sm text-muted-foreground">
      Plugins that ship a UI appear here. Their configuration is owned by the plugin itself.
    </p>
  </header>

  {#if data.error}
    <div class="rounded border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
      Failed to load plugin manifest: {data.error}
    </div>
  {/if}

  <PluginSlotHost
    slot="settings.plugins"
    entries={data.entries}
    {theme}
    {tokens}
    gatewayBaseUrl={data.gatewayUrl}
    authToken={data.authToken}
  />
</section>
