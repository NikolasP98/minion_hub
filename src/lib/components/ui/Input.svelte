<script lang="ts" module>
  export type InputSize = 'sm' | 'md' | 'lg';

  const SIZE: Record<InputSize, string> = {
    sm: 'h-7 px-2.5 text-xs',
    md: 'h-9 px-3 text-sm',
    lg: 'h-11 px-3.5 text-sm',
  };

  let _uid = 0;
  function nextId(): string {
    _uid += 1;
    return `inp-${_uid}`;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    value?: string;
    type?: 'text' | 'email' | 'password' | 'number' | 'search' | 'url' | 'tel';
    label?: string;
    placeholder?: string;
    helper?: string;
    error?: string;
    size?: InputSize;
    disabled?: boolean;
    required?: boolean;
    id?: string;
    class?: string;
    /** Leading adornment (e.g. an icon). */
    leading?: Snippet;
    oninput?: (e: Event) => void;
    [key: string]: unknown;
  }

  let {
    value = $bindable(''),
    type = 'text',
    label,
    placeholder,
    helper,
    error,
    size = 'md',
    disabled = false,
    required = false,
    id,
    class: cls = '',
    leading,
    oninput,
    ...rest
  }: Props = $props();

  const generatedId = nextId();
  const fieldId = $derived(id ?? generatedId);
  const hasError = $derived(!!error);
  const describedBy = $derived(error ? `${fieldId}-err` : helper ? `${fieldId}-help` : undefined);
</script>

<div class={`flex flex-col gap-1.5 ${cls}`}>
  {#if label}
    <label for={fieldId} class="t-label normal-case tracking-normal text-foreground/80">
      {label}{#if required}<span class="text-destructive ml-0.5">*</span>{/if}
    </label>
  {/if}

  <div class="relative flex items-center">
    {#if leading}
      <span class="absolute left-2.5 flex items-center text-muted-foreground pointer-events-none">
        {@render leading()}
      </span>
    {/if}
    <input
      {type}
      {disabled}
      {required}
      id={fieldId}
      bind:value
      {placeholder}
      {oninput}
      aria-invalid={hasError ? 'true' : undefined}
      aria-describedby={describedBy}
      class={`focus-ring-none w-full rounded-[var(--radius-md)] bg-bg2 border text-foreground placeholder:text-muted-foreground
        transition-colors duration-[150ms] disabled:opacity-50 disabled:cursor-not-allowed
        ${SIZE[size]} ${leading ? 'pl-8' : ''}
        ${hasError
          ? 'border-[color-mix(in_srgb,var(--color-destructive)_55%,transparent)] focus:border-destructive'
          : 'border-[var(--hairline)] focus:border-accent/60'}`}
      {...rest}
    />
  </div>

  {#if error}
    <span id={`${fieldId}-err`} class="t-caption text-destructive" role="alert">{error}</span>
  {:else if helper}
    <span id={`${fieldId}-help`} class="t-caption">{helper}</span>
  {/if}
</div>
