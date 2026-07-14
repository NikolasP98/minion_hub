<script lang="ts" module>
  export type AppDecoration = 'default' | 'crt' | 'voxelized';
  export type AppDensity = 'comfortable' | 'compact';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
    decoration?: AppDecoration;
    density?: AppDensity;
    class?: string;
  }

  let {
    children,
    decoration = 'default',
    density = 'comfortable',
    class: cls = '',
  }: Props = $props();
</script>

<div
  data-component="app-viewport"
  data-part="app-viewport"
  data-decoration={decoration}
  data-density={density}
  class={cls}
>
  {@render children()}
</div>

<style>
  [data-component='app-viewport'] {
    display: flex;
    box-sizing: border-box;
    width: 100%;
    height: 100vh;
    height: 100dvh;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    color: var(--color-text-primary, var(--color-foreground));
    background: var(--color-canvas, var(--color-bg));
    padding: env(safe-area-inset-top, 0) env(safe-area-inset-right, 0)
      env(safe-area-inset-bottom, 0) env(safe-area-inset-left, 0);
  }
  [data-density='comfortable'] {
    --active-control-min-height: var(--control-height-touch, 44px);
  }
  [data-density='compact'] {
    --active-control-min-height: var(--control-height-md, 32px);
  }
  @media (pointer: coarse), (max-width: 767.98px) {
    [data-component='app-viewport'] {
      --active-control-min-height: var(--control-height-touch, 44px);
    }
  }
</style>
