<script lang="ts">
  import { Button } from '$lib/components/ui';
  import type { PluginUiManifestOccupant } from './plugin-types';
  import PluginIframe from './PluginIframe.svelte';
  import { SLOT_DEFINITIONS, type PluginSlot } from './slots';
  import type { Theme } from './bridge-protocol';
  import { Puzzle } from 'lucide-svelte';
  import { BRAND_ICON_SET, PLUGIN_ICON_MAP } from './icon-map';
  import ChannelBrandIcon from '$lib/components/channels/ChannelBrandIcon.svelte';

  interface Props {
    slot: PluginSlot;
    entries: PluginUiManifestOccupant[];
    theme: Theme;
    tokens: Record<string, string>;
    /**
     * Optional. When omitted, defaults to the active host (`getActiveHost()`)
     * and `fetchHostToken()` is used to obtain a per-user token rather
     * than receiving one in props. Keeps plaintext tokens out of SSR
     * page data.
     */
    gatewayBaseUrl?: string;
    authToken?: string;
  }

  let { slot, entries, theme, tokens, gatewayBaseUrl = '', authToken = '' }: Props = $props();

  let selected = $state(0);

  const def = $derived(SLOT_DEFINITIONS[slot]);
  const current = $derived(entries[selected]);

  function renderIcon(entry: PluginUiManifestOccupant) {
    if (!entry.icon) return null;
    if (/\p{Extended_Pictographic}/u.test(entry.icon)) return entry.icon;
    if (BRAND_ICON_SET.has(entry.icon)) return 'brand:' + entry.icon;
    if (PLUGIN_ICON_MAP[entry.icon]) return 'lucide:' + entry.icon;
    return null;
  }
</script>

{#if entries.length === 0}
  <div class="p-6 text-sm text-muted-foreground">
    No plugins installed for this slot ({def.label}).
  </div>
{:else}
  <!-- Layout: tabs is the only Phase A layout. cards/list fall back to tabs. -->
  <div class="flex flex-col">
    <div role="tablist" class="flex border-b border-border" aria-label={def.label}>
      {#each entries as entry, i (entry.pluginId + ':' + entry.entrypoint)}
        <Button
          variant="ghost"
          type="button"
          role="tab"
          aria-selected={selected === i}
          class="border-b-2 px-4 py-2 text-sm transition-colors hover:bg-muted text-foreground {selected ===
          i
            ? 'border-foreground'
            : 'border-transparent'}"
          onclick={() => (selected = i)}
        >
          {#if entry.icon}
            {@const resolved = renderIcon(entry)}
            {#if resolved?.startsWith('brand:')}
              <span class="mr-2 inline-flex align-text-bottom"
                ><ChannelBrandIcon channel={entry.icon} size={16} /></span
              >
            {:else if resolved?.startsWith('lucide:')}
              {@const IconComp = PLUGIN_ICON_MAP[entry.icon]}
              <span class="mr-2 inline-flex align-text-bottom"><IconComp size={16} /></span>
            {:else}
              <span class="mr-2">{entry.icon}</span>
            {/if}
          {/if}
          {entry.title}
        </Button>
      {/each}
    </div>

    {#if current}
      <div class="flex-1">
        <PluginIframe
          pluginId={current.pluginId}
          entrypoint={current.entrypoint}
          gatewayUrl={gatewayBaseUrl}
          {authToken}
          {theme}
          {tokens}
          compat={current.compat}
          pluginStatus={current.status}
        />
      </div>
    {/if}
  </div>
{/if}
