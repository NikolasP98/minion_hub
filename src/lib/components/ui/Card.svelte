<script lang="ts" module>
  export type CardElevation = 1 | 2 | 3 | 4;
  export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

  const PAD: Record<CardPadding, string> = {
    none: '',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-5',
  };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Compound elevation surface (bg + hairline border + shadow). */
    elevation?: CardElevation;
    padding?: CardPadding;
    /**
     * Adds a hover-lift affordance. Card stays presentational — for a clickable
     * card, wrap the content in an <a>/<Button> or place an overlay link inside.
     */
    interactive?: boolean;
    class?: string;
    header?: Snippet;
    children?: Snippet;
    footer?: Snippet;
  }

  let {
    elevation = 2,
    padding = 'md',
    interactive = false,
    class: cls = '',
    header,
    children,
    footer,
  }: Props = $props();

  const surface = $derived(`surface-${elevation}`);
  const interactiveCls = $derived(
    interactive
      ? 'transition-[border-color,box-shadow,transform] duration-[150ms] ease-[cubic-bezier(0.2,0,0,1)] ' +
          'hover:border-[var(--elevation-3-border)] hover:shadow-lg ' +
          'has-[a:hover,button:hover]:border-[var(--elevation-3-border)]'
      : ''
  );
</script>

<div class={`${surface} rounded-[var(--radius-lg)] ${interactiveCls} ${cls}`}>
  {#if header}
    <div class={`${padding === 'none' ? '' : 'px-4 py-3'} border-b border-[var(--hairline)]`}>
      {@render header()}
    </div>
  {/if}
  <div class={PAD[padding]}>
    {#if children}{@render children()}{/if}
  </div>
  {#if footer}
    <div class={`${padding === 'none' ? '' : 'px-4 py-3'} border-t border-[var(--hairline)]`}>
      {@render footer()}
    </div>
  {/if}
</div>
