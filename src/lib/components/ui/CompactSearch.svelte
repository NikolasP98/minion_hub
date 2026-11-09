<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { Search } from 'lucide-svelte';
  import { iconSizes } from './icon-sizes';

  type Props = Omit<HTMLInputAttributes, 'value' | 'class'> & {
    value?: string;
    inputRef?: HTMLInputElement | null;
    fullWidth?: boolean;
    class?: string;
  };
  let {
    value = $bindable(''),
    inputRef = $bindable(null),
    fullWidth = false,
    class: klass = '',
    placeholder,
    'aria-label': label,
    ...rest
  }: Props = $props();
</script>

<div class="compact-search {klass}" class:full-width={fullWidth}>
  <Search size={iconSizes.sm} aria-hidden="true" />
  <input
    bind:this={inputRef}
    bind:value
    {placeholder}
    aria-label={label ?? placeholder}
    class="t-body"
    {...rest}
  />
</div>

<style>
  .compact-search {
    position: relative;
    display: inline-flex;
    align-items: center;
    min-width: calc(var(--space-6) * 6);
  }
  .full-width {
    width: 100%;
    min-width: 0;
  }
  .compact-search :global(svg) {
    position: absolute;
    left: var(--space-1);
    color: var(--color-text-tertiary);
    pointer-events: none;
  }
  input {
    width: 100%;
    height: var(--control-height-xs);
    padding: 0 var(--space-2) 0 var(--space-6);
    color: var(--color-text-primary);
    background: transparent;
    border: 1px solid transparent;
    border-bottom-color: var(--color-border-subtle);
    border-radius: var(--radius-sm);
    transition:
      background-color var(--duration-fast) var(--ease-standard),
      border-color var(--duration-fast) var(--ease-standard);
  }
  input::placeholder {
    color: var(--color-text-tertiary);
    opacity: 0.7;
  }
  input:hover {
    background: var(--color-surface-1);
  }
  input:focus {
    outline: none;
    background: var(--color-surface-3);
    border-color: color-mix(in srgb, var(--color-accent) 55%, transparent);
  }
  input:focus-visible {
    box-shadow: var(--shadow-focus);
  }
  @media (max-width: 767.98px), (pointer: coarse) {
    input {
      height: var(--control-height-touch);
    }
  }
</style>
