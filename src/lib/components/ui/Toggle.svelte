<script lang="ts" module>
  import type { Snippet } from 'svelte';

  export type ToggleSize = 'sm' | 'md';

  interface ToggleCommonProps {
    checked?: boolean;
    size?: ToggleSize;
    disabled?: boolean;
    description?: string;
    class?: string;
    onchange?: (checked: boolean) => void;
    children?: Snippet;
    [key: string]: unknown;
  }

  /** Legacy Hub prop names retained by the shared Toggle compatibility adapter. */
  export type ToggleProps = ToggleCommonProps &
    ({ label: string; ariaLabel?: string } | { label?: string; ariaLabel: string });
</script>

<script lang="ts">
  import { Toggle as SharedToggle } from '@minion-stack/ui';

  let {
    checked = $bindable(false),
    size = 'md',
    disabled = false,
    label,
    ariaLabel,
    description,
    class: cls = '',
    onchange,
    children,
    ...rest
  }: ToggleProps = $props();

  const accessibleLabel = $derived(label ?? ariaLabel ?? '');

  function handleChange(next: boolean) {
    checked = next;
    onchange?.(next);
  }
</script>

<span
  class={`inline-flex items-center gap-[var(--space-2)] ${disabled ? 'opacity-50' : ''} ${cls}`}
  data-component="toggle-compat"
>
  <SharedToggle
    {...rest}
    pressed={checked}
    label={accessibleLabel}
    {size}
    {disabled}
    onchange={handleChange}
  />
  {#if children || label || description}
    <span class="min-w-0 leading-tight">
      {#if children}
        <span class="text-sm text-foreground">{@render children()}</span>
      {:else if label}
        <span class="text-sm text-foreground">{label}</span>
      {/if}
      {#if description}
        <span class="t-caption block">{description}</span>
      {/if}
    </span>
  {/if}
</span>
