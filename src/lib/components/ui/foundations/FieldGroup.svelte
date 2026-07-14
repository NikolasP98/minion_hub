<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    label: string;
    children: Snippet;
    direction?: 'row' | 'column';
    class?: string;
  }

  let { label, children, direction = 'column', class: cls = '' }: Props = $props();
</script>

<div
  data-component="field-group"
  data-direction={direction}
  role="group"
  aria-label={label}
  class={cls}
>
  {@render children()}
</div>

<style>
  [data-component='field-group'] {
    display: flex;
    gap: var(--space-2, 8px);
  }
  [data-direction='column'] {
    flex-direction: column;
  }
  [data-direction='row'] {
    flex-flow: row wrap;
    align-items: center;
  }
</style>
