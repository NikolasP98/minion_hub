<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    legend: string;
    helper?: string;
    error?: string;
    disabled?: boolean;
    required?: boolean;
    children: Snippet;
    class?: string;
  }

  let {
    legend,
    helper,
    error,
    disabled = false,
    required = false,
    children,
    class: cls = '',
  }: Props = $props();

  const uid = $props.id();
  const helperId = `${uid}-helper`;
  const errorId = `${uid}-error`;
  const describedBy = $derived(error ? errorId : helper ? helperId : undefined);
</script>

<fieldset
  data-component="form-fieldset"
  {disabled}
  aria-describedby={describedBy}
  data-invalid={error ? 'true' : undefined}
  class={cls}
>
  <legend>
    {legend}{#if required}<span aria-hidden="true">*</span>{/if}
  </legend>
  <div data-part="options">{@render children()}</div>
  {#if error}
    <p id={errorId} data-part="error" role="alert">{error}</p>
  {:else if helper}
    <p id={helperId} data-part="helper">{helper}</p>
  {/if}
</fieldset>

<style>
  fieldset {
    display: grid;
    min-width: 0;
    margin: 0;
    padding: 0;
    gap: var(--space-field-gap, 8px);
    border: 0;
  }
  legend {
    padding: 0;
    color: var(--color-text-secondary, var(--color-muted));
    font-size: var(--font-size-label, 12px);
    line-height: var(--line-height-compact, 16px);
    font-weight: var(--font-weight-medium, 500);
    letter-spacing: var(--letter-spacing-label, 0.04em);
  }
  legend span {
    margin-left: var(--space-0-5, 2px);
    color: var(--color-danger-fg, var(--color-destructive));
  }
  [data-part='options'] {
    display: grid;
    gap: var(--space-2, 8px);
  }
  [data-part='helper'],
  [data-part='error'] {
    margin: 0;
    font-size: var(--font-size-caption, 12px);
    line-height: var(--line-height-compact, 16px);
  }
  [data-part='helper'] {
    color: var(--color-text-tertiary, var(--color-muted-foreground));
  }
  [data-part='error'] {
    color: var(--color-danger-fg, var(--color-destructive));
  }
</style>
