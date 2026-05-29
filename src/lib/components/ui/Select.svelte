<script lang="ts" module>
  export type SelectSize = 'sm' | 'md';
  export type SelectOption = { value: string; label: string; disabled?: boolean };
</script>

<script lang="ts">
  import { ChevronDown } from 'lucide-svelte';
  import type { Snippet } from 'svelte';

  let nextId = 0;
  const generatedId = `select-${nextId++}`;

  interface Props {
    /** Bindable selected value. */
    value?: string;
    /** Convenience: render options from an array. Use `children` for custom <option>s. */
    options?: SelectOption[];
    size?: SelectSize;
    label?: string;
    helper?: string;
    error?: string;
    disabled?: boolean;
    required?: boolean;
    id?: string;
    name?: string;
    class?: string;
    onchange?: (value: string) => void;
    /** Custom <option>/<optgroup> markup (overrides `options`). */
    children?: Snippet;
    [key: string]: unknown;
  }

  let {
    value = $bindable(''),
    options,
    size = 'md',
    label,
    helper,
    error,
    disabled = false,
    required = false,
    id,
    name,
    class: cls = '',
    onchange,
    children,
    ...rest
  }: Props = $props();

  const fieldId = $derived(id ?? generatedId);
  const describedBy = $derived(error ? `${fieldId}-err` : helper ? `${fieldId}-help` : undefined);

  const sizeCls = $derived(size === 'sm' ? 'h-8 text-xs pl-2.5 pr-8' : 'h-9 text-sm pl-3 pr-9');

  function handleChange(e: Event) {
    value = (e.currentTarget as HTMLSelectElement).value;
    onchange?.(value);
  }
</script>

<div class={`flex flex-col gap-1 ${cls}`}>
  {#if label}
    <label for={fieldId} class="t-label normal-case tracking-normal text-[0.75rem] text-muted">
      {label}{#if required}<span class="text-destructive ml-0.5">*</span>{/if}
    </label>
  {/if}
  <div class="relative">
    <select
      {...rest}
      id={fieldId}
      {name}
      {disabled}
      {required}
      aria-invalid={error ? 'true' : undefined}
      aria-describedby={describedBy}
      value={value}
      onchange={handleChange}
      class={`w-full appearance-none rounded-[var(--radius-md)] bg-[var(--elevation-2-bg)]
        border border-[var(--hairline)] text-foreground outline-none cursor-pointer
        transition-[border-color,box-shadow] duration-[var(--duration-fast)] ease-[var(--ease-standard)]
        hover:border-white/15
        focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-accent)_25%,transparent)]
        disabled:opacity-50 disabled:cursor-not-allowed
        ${error ? 'border-destructive' : ''} ${sizeCls}`}
    >
      {#if children}
        {@render children()}
      {:else if options}
        {#each options as opt (opt.value)}
          <option value={opt.value} disabled={opt.disabled}>{opt.label}</option>
        {/each}
      {/if}
    </select>
    <ChevronDown
      size={size === 'sm' ? 13 : 15}
      class="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
    />
  </div>
  {#if error}
    <p id="{fieldId}-err" class="t-caption text-destructive">{error}</p>
  {:else if helper}
    <p id="{fieldId}-help" class="t-caption">{helper}</p>
  {/if}
</div>
