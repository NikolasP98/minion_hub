<script lang="ts" module>
  export type SectionShellMode = 'responsive' | 'stacked' | 'split';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
    navigation?: Snippet;
    mode?: SectionShellMode;
    variant?: 'default' | 'canvas' | 'terminal';
    class?: string;
  }

  let {
    children,
    navigation,
    mode = 'responsive',
    variant = 'default',
    class: cls = '',
  }: Props = $props();
</script>

<div
  data-component="section-shell"
  data-part="section-shell"
  data-mode={mode}
  data-variant={variant}
  class={cls}
>
  {#if navigation}
    <div data-part="section-navigation">{@render navigation()}</div>
  {/if}
  <div data-part="section-content">{@render children()}</div>
</div>

<style>
  [data-component='section-shell'] {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
    overflow: hidden;
  }
  [data-part='section-navigation'] {
    min-width: 0;
    min-height: 0;
    flex: none;
  }
  [data-part='section-content'] {
    display: flex;
    min-width: 0;
    min-height: 0;
    flex: 1;
  }
  [data-mode='stacked'] {
    flex-direction: column;
  }
  [data-mode='stacked'] [data-part='section-navigation'] {
    width: 100%;
  }
  [data-mode='split'] {
    flex-direction: row;
  }
  @media (max-width: 1279.98px) {
    [data-mode='responsive'] {
      flex-direction: column;
    }
    [data-mode='responsive'] [data-part='section-navigation'] {
      width: 100%;
    }
  }
</style>
