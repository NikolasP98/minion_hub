<script lang="ts">
  import type { Snippet } from 'svelte';
  import { portal, type PortalTarget } from './layer';

  interface Props {
    children: Snippet;
    target?: PortalTarget;
    disabled?: boolean;
  }

  let { children, target = 'body', disabled = false }: Props = $props();
</script>

<div data-portal-root use:portal={{ target, disabled }}>
  {@render children()}
</div>

<style>
  [data-portal-root] {
    display: contents;
  }
</style>
