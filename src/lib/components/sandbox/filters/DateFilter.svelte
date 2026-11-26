<script lang="ts">
  import { ChevronDown, X } from 'lucide-svelte';
  import { Button, Dropdown, iconSizes } from '$lib/components/ui';
  import { RANGES, type PageValue, type Range } from '$lib/sandbox/blocks/schema';
  import * as m from '$lib/paraglide/messages';
  import { RANGE_LABEL } from './ranges';

  /**
   * Date filter (spec 150): one of the block date presets. "All time" is a real
   * preset; clearing removes the value entirely (blocks then show their own range).
   */
  interface Props {
    label: string;
    value: PageValue | null;
    onchange: (value: PageValue | null) => void;
  }

  let { label, value, onchange }: Props = $props();

  const items = $derived(RANGES.map((range) => ({ value: range, label: RANGE_LABEL[range]() })));
  const current = $derived(
    value?.kind === 'date' ? RANGE_LABEL[value.range]() : m.sandbox_filter_any_date(),
  );
</script>

<div class="filter" role="group" aria-label={label}>
  <span class="t-label filter-label" aria-hidden="true">{label}</span>
  <Dropdown {items} onSelect={(range) => onchange({ kind: 'date', range: range as Range })}>
    {#snippet trigger()}
      <span class="trigger" class:set={value !== null}>
        <span class="sr-only">{label}:</span>
        {current}
        <ChevronDown size={iconSizes.sm} />
      </span>
    {/snippet}
  </Dropdown>
  {#if value}
    <Button
      variant="ghost"
      size="sm"
      aria-label={m.sandbox_filter_clear()}
      title={m.sandbox_filter_clear()}
      onclick={() => onchange(null)}
    >
      <X size={iconSizes.sm} />
    </Button>
  {/if}
</div>

<style>
  .filter {
    display: flex;
    align-items: center;
    gap: var(--space-control-gap);
  }
  .filter-label {
    color: var(--color-text-secondary);
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: var(--control-height-sm);
    padding: 0 var(--space-2);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
  }
  .trigger.set {
    border-color: var(--color-accent);
    color: var(--color-text-primary);
  }
</style>
