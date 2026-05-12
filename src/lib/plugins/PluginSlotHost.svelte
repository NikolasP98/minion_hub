<script lang="ts">
  import PluginIframe from "./PluginIframe.svelte";
  import { SLOT_DEFINITIONS, type PluginSlot } from "./slots";
  import type { Theme } from "./bridge-protocol";

  export interface PluginUiManifestOccupant {
    pluginId: string;
    slot: PluginSlot;
    title: string;
    description: string;
    entrypoint: string;
    icon?: string;
  }

  interface Props {
    slot: PluginSlot;
    entries: PluginUiManifestOccupant[];
    theme: Theme;
    tokens: Record<string, string>;
    gatewayBaseUrl: string;
    hostOrigin: string;
    authToken?: string;
  }

  let {
    slot,
    entries,
    theme,
    tokens,
    gatewayBaseUrl,
    hostOrigin,
    authToken = "",
  }: Props = $props();

  let selected = $state(0);

  // hostOrigin is reserved for future origin-lock enforcement; bridge-host
  // currently derives pluginOrigin from gatewayBaseUrl. Reference inside a
  // $derived to silence Svelte's "state_referenced_locally" warning.
  const _hostOriginRef = $derived(hostOrigin);
  void _hostOriginRef;

  const def = $derived(SLOT_DEFINITIONS[slot]);
  const current = $derived(entries[selected]);
</script>

{#if entries.length === 0}
  <div class="p-6 text-sm text-muted-foreground">
    No plugins installed for this slot ({def.label}).
  </div>
{:else}
  <!-- Layout: tabs is the only Phase A layout. cards/list fall back to tabs. -->
  <div class="flex flex-col">
    <div role="tablist" class="flex border-b border-border" aria-label={def.label}>
      {#each entries as entry, i (entry.pluginId + ":" + entry.entrypoint)}
        <button
          type="button"
          role="tab"
          aria-selected={selected === i}
          class="border-b-2 px-4 py-2 text-sm transition-colors hover:bg-muted text-foreground"
          class:border-foreground={selected === i}
          class:border-transparent={selected !== i}
          onclick={() => (selected = i)}
        >
          {#if entry.icon}<span class="mr-2">{entry.icon}</span>{/if}
          {entry.title}
        </button>
      {/each}
    </div>

    {#if current}
      <div class="flex-1">
        <PluginIframe
          pluginId={current.pluginId}
          gatewayUrl={gatewayBaseUrl}
          {authToken}
          {theme}
          {tokens}
        />
      </div>
    {/if}
  </div>
{/if}
