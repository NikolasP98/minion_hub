<script lang="ts" module>
  export type RouteArchetype =
    | 'dashboard'
    | 'collection'
    | 'record-detail'
    | 'form'
    | 'master-detail'
    | 'workspace'
    | 'canvas'
    | 'terminal'
    | 'public';
  export type PageScrollMode = 'page' | 'region' | 'none';
  export type PageDirection = 'column' | 'row';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
    archetype: RouteArchetype;
    scroll?: PageScrollMode;
    direction?: PageDirection;
    variant?: 'default' | 'crt' | 'voxelized' | 'canvas' | 'terminal';
    labelledBy?: string;
    landmark?: boolean;
    class?: string;
  }

  let {
    children,
    archetype,
    scroll = 'page',
    direction = 'column',
    variant = 'default',
    labelledBy,
    landmark = true,
    class: cls = '',
  }: Props = $props();
</script>

{#if landmark}
  <main
    data-component="page-shell"
    data-part="page-shell"
    data-archetype={archetype}
    data-scroll={scroll}
    data-direction={direction}
    data-variant={variant}
    aria-labelledby={labelledBy}
    class={cls}
  >
    {@render children()}
  </main>
{:else}
  <div
    data-component="page-shell"
    data-part="page-shell"
    data-archetype={archetype}
    data-scroll={scroll}
    data-direction={direction}
    data-variant={variant}
    class={cls}
  >
    {@render children()}
  </div>
{/if}

<style>
  [data-component='page-shell'] {
    display: flex;
    width: 100%;
    min-width: 0;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    color: var(--color-text-primary, var(--color-foreground));
    background: var(--color-canvas, var(--color-bg));
  }
  [data-scroll='page'] {
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
  }
  [data-scroll='region'],
  [data-scroll='none'] {
    overflow: hidden;
  }
  [data-direction='row'] {
    flex-direction: row;
  }
  [data-archetype='canvas'],
  [data-archetype='terminal'],
  [data-archetype='workspace'] {
    isolation: isolate;
  }
</style>
