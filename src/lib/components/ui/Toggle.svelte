<script lang="ts" module>
  export type ToggleSize = 'sm' | 'md';
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    /** Bindable on/off state. */
    checked?: boolean;
    size?: ToggleSize;
    disabled?: boolean;
    /** Accessible label when no visible label snippet is provided. */
    label?: string;
    /** Accessible name without rendering visible text (when a sibling already labels it). */
    ariaLabel?: string;
    /** Optional secondary line under the label. */
    description?: string;
    class?: string;
    onchange?: (checked: boolean) => void;
    /** Visible label content (rendered to the right of the switch). */
    children?: Snippet;
  }

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
  }: Props = $props();

  const track = $derived(size === 'sm' ? 'w-7 h-4' : 'w-9 h-5');
  const knob = $derived(size === 'sm' ? 'w-3 h-3' : 'w-4 h-4');
  const shift = $derived(size === 'sm' ? 'translate-x-3' : 'translate-x-4');

  function toggle() {
    if (disabled) return;
    checked = !checked;
    onchange?.(checked);
  }
</script>

<div class={`inline-flex items-center gap-2.5 ${disabled ? 'opacity-50' : ''} ${cls}`}>
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label ?? ariaLabel}
    {disabled}
    onclick={toggle}
    class={`relative shrink-0 inline-flex items-center rounded-full p-0.5
      transition-colors duration-[var(--duration-fast)] ease-[var(--ease-standard)]
      ${track} ${checked ? 'bg-accent' : 'bg-[var(--elevation-3-bg)] border border-[var(--hairline)]'}`}
  >
    <span
      class={`inline-block rounded-full bg-white shadow-sm
        transition-transform duration-[var(--duration-fast)] ease-[var(--ease-spring)]
        ${knob} ${checked ? shift : 'translate-x-0'}`}
    ></span>
  </button>
  {#if children || label || description}
    <div class="min-w-0 leading-tight">
      {#if children}
        <span class="text-sm text-foreground">{@render children()}</span>
      {:else if label}
        <span class="text-sm text-foreground">{label}</span>
      {/if}
      {#if description}
        <p class="t-caption">{description}</p>
      {/if}
    </div>
  {/if}
</div>
