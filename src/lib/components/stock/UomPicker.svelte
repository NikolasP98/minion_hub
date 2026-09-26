<script lang="ts">
  /**
   * Unit-of-measure picker (owner directive 2026-09-25 — "units should be a
   * select picker"): a real dropdown (the themed Select primitive) over the presets plus every unit the org
   * already uses, with one "Other unit…" row that swaps in a text input, because
   * the first item of a new kind must still be creatable.
   *
   * ponytail: a native select + escape hatch instead of a free-typing combobox —
   * the Zag combobox reverts a typed value on blur unless the machine owns it,
   * and a unit is a short closed-ish list where a dropdown reads better anyway.
   */
  import { Input, Select } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { UOM_PRESETS } from './stock-ui';

  let {
    id,
    value = $bindable(''),
    label,
    placeholder,
    options = [],
    disabled = false,
  }: {
    /** Unique per instance. */
    id: string;
    value?: string;
    label?: string;
    placeholder?: string;
    /** Units already in use in this org (from the page load). */
    options?: string[];
    disabled?: boolean;
  } = $props();

  const OTHER = '\u0000other';
  const known = $derived([
    ...new Set([...options, ...UOM_PRESETS].map((u) => u.trim()).filter(Boolean)),
  ]);
  /** Typing mode: the row was picked, or the current value is a unit nobody
   *  listed (an item edited before the list existed). */
  let custom = $state(false);
  const typing = $derived(custom || (value.trim() !== '' && !known.includes(value.trim())));
  const items = $derived([
    ...known.map((u) => ({ value: u, label: u })),
    { value: OTHER, label: m.stock_uom_other() },
  ]);
</script>

{#if typing}
  <Input
    {id}
    size="sm"
    {label}
    placeholder={placeholder ?? m.stock_uom_other_ph()}
    {disabled}
    bind:value
  />
{:else}
  <Select
    {id}
    size="sm"
    {label}
    {disabled}
    options={items}
    value={value.trim()}
    onchange={(v) => {
      if (v === OTHER) {
        custom = true;
        value = '';
      } else {
        value = String(v);
      }
    }}
  />
{/if}
