<script lang="ts" module>
  export type FormFieldOrientation = 'stacked' | 'inline';
  export type FormControlProps = {
    id: string;
    disabled: boolean;
    required: boolean;
    'aria-invalid'?: 'true';
    'aria-describedby'?: string;
    'aria-errormessage'?: string;
  };
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    id?: string;
    label: string;
    helper?: string;
    error?: string;
    required?: boolean;
    disabled?: boolean;
    orientation?: FormFieldOrientation;
    hideLabel?: boolean;
    children: Snippet<[FormControlProps]>;
    class?: string;
  }

  let {
    id,
    label,
    helper,
    error,
    required = false,
    disabled = false,
    orientation = 'stacked',
    hideLabel = false,
    children,
    class: cls = '',
  }: Props = $props();

  const uid = $props.id();
  const fieldId = $derived(id ?? `${uid}-control`);
  const helperId = `${uid}-helper`;
  const errorId = `${uid}-error`;
  const describedBy = $derived(error ? errorId : helper ? helperId : undefined);
  const controlProps = $derived<FormControlProps>({
    id: fieldId,
    disabled,
    required,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': describedBy,
    'aria-errormessage': error ? errorId : undefined,
  });
</script>

<div
  data-component="form-field"
  data-orientation={orientation}
  data-invalid={error ? 'true' : undefined}
  data-disabled={disabled ? 'true' : undefined}
  class={`form-field ${cls}`}
>
  <label for={fieldId} class:visually-hidden={hideLabel}>
    {label}
    {#if required}<span class="required-mark" aria-hidden="true">*</span>{/if}
  </label>
  <div data-part="control">{@render children(controlProps)}</div>
  {#if error}
    <p id={errorId} data-part="error" role="alert">{error}</p>
  {:else if helper}
    <p id={helperId} data-part="helper">{helper}</p>
  {/if}
</div>

<style>
  .form-field {
    display: grid;
    gap: var(--space-field-gap, 8px);
    min-width: 0;
  }
  .form-field[data-orientation='inline'] {
    grid-template-columns: minmax(8rem, 0.35fr) minmax(0, 1fr);
    align-items: start;
    column-gap: var(--space-4, 16px);
  }
  .form-field[data-orientation='inline'] [data-part='helper'],
  .form-field[data-orientation='inline'] [data-part='error'] {
    grid-column: 2;
  }
  label {
    color: var(--color-text-secondary, var(--color-muted));
    font-size: var(--font-size-label, 12px);
    line-height: var(--line-height-compact, 16px);
    font-weight: var(--font-weight-medium, 500);
    letter-spacing: var(--letter-spacing-label, 0.04em);
  }
  .required-mark {
    margin-left: var(--space-0-5, 2px);
    color: var(--color-danger-fg, var(--color-destructive));
  }
  [data-part='control'] {
    min-width: 0;
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
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 767.98px) {
    .form-field[data-orientation='inline'] {
      grid-template-columns: minmax(0, 1fr);
    }
    .form-field[data-orientation='inline'] [data-part='helper'],
    .form-field[data-orientation='inline'] [data-part='error'] {
      grid-column: 1;
    }
  }
</style>
