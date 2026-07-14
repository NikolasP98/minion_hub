<script lang="ts" module>
  import type { Snippet } from 'svelte';

  export type SelectSize = 'xs' | 'sm' | 'md';
  export type SelectValue = string | number;
  export type SelectOption = { value: SelectValue; label: string; disabled?: boolean };

  export function selectValueFromChange(event: Event): SelectValue {
    const select = event.currentTarget as HTMLSelectElement;
    const option = select.selectedOptions.item(0) as
      (HTMLOptionElement & { __value?: SelectValue }) | null;
    return option?.__value ?? select.value;
  }

  /**
   * Compatibility contract for historical Hub call sites. New product surfaces
   * should import Select and its string-valued contract from `@minion-stack/ui`.
   */
  export interface SelectProps {
    value?: SelectValue;
    options?: SelectOption[];
    size?: SelectSize;
    label?: string;
    helper?: string;
    error?: string;
    disabled?: boolean;
    required?: boolean;
    id?: string;
    name?: string;
    /** Historical Hub compatibility: styles the native select control. */
    class?: string;
    /** Styles the outer FormField layout wrapper. */
    fieldClass?: string;
    /** Explicit additive styles for the native select control. */
    selectClass?: string;
    onchange?: (value: SelectValue) => void;
    children?: Snippet;
    [key: string]: unknown;
  }
</script>

<script lang="ts">
  import {
    Select as SharedSelect,
    type SelectOption as SharedSelectOption,
    type SelectSize as SharedSelectSize,
  } from '@minion-stack/ui';

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
    class: legacyControlClass = '',
    fieldClass = '',
    selectClass: explicitControlClass = '',
    onchange,
    children,
    ...rest
  }: SelectProps = $props();

  // The shared primitive deliberately has no `xs` public variant. Keep the
  // historical Hub density through its canonical xs height token while the
  // shared primitive continues to own every interaction and semantic style.
  const sharedSize = $derived<SharedSelectSize>(size === 'xs' ? 'sm' : size);
  const controlClass = $derived(
    [
      legacyControlClass,
      explicitControlClass,
      size === 'xs'
        ? '!h-[var(--control-height-xs)] !px-[var(--space-2)] !text-[length:var(--font-size-caption)]'
        : '',
    ]
      .filter(Boolean)
      .join(' '),
  );

  // Runtime values stay untouched. The cast only bridges the package's narrow
  // string declaration so legacy numeric options keep Svelte's native __value.
  const sharedValue = $derived(value as string);
  const sharedOptions = $derived(
    children ? [] : ((options ?? []) as unknown as readonly SharedSelectOption[]),
  );

  function handleChange(event: Event) {
    const next = selectValueFromChange(event);
    value = next;
    onchange?.(next);
  }
</script>

<SharedSelect
  {...rest}
  value={sharedValue}
  options={sharedOptions}
  size={sharedSize}
  {label}
  {helper}
  {error}
  {disabled}
  {required}
  {id}
  {name}
  class={fieldClass}
  selectClass={controlClass}
  {children}
  onchange={handleChange}
/>
