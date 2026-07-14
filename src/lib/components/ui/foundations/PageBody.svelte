<script lang="ts" module>
  export type PageBodyWidth = 'full' | 'content' | 'reading';
  export type PageBodyPadding = 'none' | 'compact' | 'default';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
    width?: PageBodyWidth;
    padding?: PageBodyPadding;
    scroll?: 'inherit' | 'region' | 'none';
    class?: string;
  }

  let {
    children,
    width = 'full',
    padding = 'default',
    scroll = 'inherit',
    class: cls = '',
  }: Props = $props();
</script>

<div
  data-component="page-body"
  data-part="page-body"
  data-width={width}
  data-padding={padding}
  data-scroll={scroll}
  class={cls}
>
  {@render children()}
</div>

<style>
  [data-component='page-body'] {
    width: 100%;
    min-width: 0;
    min-height: 0;
    flex: 1;
  }
  [data-width='content'] {
    max-width: 80rem;
    margin-inline: auto;
  }
  [data-width='reading'] {
    max-width: 48rem;
    margin-inline: auto;
  }
  [data-padding='compact'] {
    padding: var(--space-card, 16px);
  }
  [data-padding='default'] {
    padding: var(--space-page-section, 32px) var(--space-page-gutter, 32px);
  }
  [data-scroll='region'] {
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
  }
  [data-scroll='none'] {
    overflow: hidden;
  }
  @media (max-width: 1279.98px) {
    [data-padding='default'] {
      padding-inline: var(--space-page-gutter, 24px);
    }
  }
  @media (max-width: 767.98px) {
    [data-padding='default'] {
      padding: var(--space-section, 24px) var(--space-page-gutter, 16px);
    }
  }
</style>
