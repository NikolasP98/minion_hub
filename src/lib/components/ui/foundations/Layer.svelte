<script lang="ts">
  import type { Snippet } from 'svelte';
  import Portal from './Portal.svelte';
  import type { LayerTier, PortalTarget } from './layer';

  interface Props {
    tier: LayerTier;
    children: Snippet;
    portal?: boolean;
    target?: PortalTarget;
    position?: 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';
    role?: string;
    class?: string;
  }

  let {
    tier,
    children,
    portal = false,
    target = 'body',
    position = 'relative',
    role,
    class: cls = '',
  }: Props = $props();
</script>

{#snippet layerContent()}
  <div data-layer={tier} data-part="layer" class={`layer ${cls}`} style:position {role}>
    {@render children()}
  </div>
{/snippet}

{#if portal}
  <Portal {target}>{@render layerContent()}</Portal>
{:else}
  {@render layerContent()}
{/if}

<style>
  .layer[data-layer='base'] {
    z-index: var(--layer-base, 0);
  }
  .layer[data-layer='sticky'] {
    z-index: var(--layer-sticky, 10);
  }
  .layer[data-layer='navigation'] {
    z-index: var(--layer-navigation, 20);
  }
  .layer[data-layer='dropdown'] {
    z-index: var(--layer-dropdown, 30);
  }
  .layer[data-layer='popover'] {
    z-index: var(--layer-popover, 40);
  }
  .layer[data-layer='modal'] {
    z-index: var(--layer-modal, 50);
  }
  .layer[data-layer='toast'] {
    z-index: var(--layer-toast, 60);
  }
  .layer[data-layer='command'] {
    z-index: var(--layer-command, 70);
  }
  .layer[data-layer='debug'] {
    z-index: var(--layer-debug, 100);
  }
</style>
