<script lang="ts" module>
  export type GroupByOption = { value: string; label: string };
</script>

<script lang="ts">
  /**
   * Compact group-by affordance (spec 2026-09-29 table-toolbar): idle is an
   * icon-only ghost button; once a value is picked it becomes icon + label in
   * an accent-tinted pill with a hover-reveal × that clears back to `''` (no
   * grouping). Clicking anywhere else on the pill reopens the option list.
   *
   * The trigger snippet's content renders INSIDE Dropdown's own trigger
   * element — so it stays plain markup (spans), never a nested `Button`
   * component or a raw button tag (see DataTable's `dt-add-menu` for the
   * same idiom). The × is therefore a real sibling `Button`, not a
   * descendant, so it never fights the Dropdown's own click-to-open handling.
   */
  import { Rows3, X, Check } from 'lucide-svelte';
  import { Button, Dropdown, Tooltip, iconSizes } from '$lib/components/ui';
  import type { DropdownItem } from '$lib/components/ui/Dropdown.svelte';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    options: GroupByOption[];
    /** Current value. `''` = no grouping. */
    value: string;
    onChange: (value: string) => void;
    /** When given, prepended to the option list as the "clear" choice. */
    noneLabel?: string;
    class?: string;
  }

  let { options, value, onChange, noneLabel, class: cls = '' }: Props = $props();

  const active = $derived(value !== '');
  const selectedLabel = $derived(options.find((o) => o.value === value)?.label ?? '');
  const items = $derived([
    ...(noneLabel ? [{ value: '', label: noneLabel }] : []),
    ...options.map((o) => ({ value: o.value, label: o.label })),
  ]);

  function clear(e: MouseEvent) {
    e.stopPropagation();
    onChange('');
  }
</script>

<div class="gbp {cls}" class:active>
  <Dropdown {items} onSelect={(v) => onChange(v)} item={optionRow}>
    {#snippet trigger()}
      {#if active}
        <span class="gbp-btn gbp-pill">
          <Rows3 size={iconSizes.sm} />
          <span class="gbp-label">{selectedLabel}</span>
        </span>
      {:else}
        <Tooltip label={m.catalog_group_by()}>
          {#snippet children()}
            <span class="gbp-btn">
              <Rows3 size={iconSizes.sm} />
              <span class="sr-only">{m.catalog_group_by()}</span>
            </span>
          {/snippet}
        </Tooltip>
      {/if}
    {/snippet}
  </Dropdown>
  {#if active}
    <Button
      variant="ghost"
      size="xs"
      class="gbp-clear"
      aria-label={m.data_table_group_by_clear()}
      onpointerdown={(e: PointerEvent) => e.stopPropagation()}
      onclick={clear}
    >
      <X size={iconSizes.xs} />
    </Button>
  {/if}
</div>

{#snippet optionRow({ item }: { item: DropdownItem; highlighted: boolean })}
  <span class="gbp-check"
    >{#if item.value === value}<Check size={iconSizes.xs} />{/if}</span
  >
  <span class="gbp-opt-label">{item.label}</span>
{/snippet}

<style>
  .gbp {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .gbp-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: var(--control-height-xs);
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-size: var(--font-size-label);
    transition:
      color var(--duration-fast) var(--ease-standard),
      background-color var(--duration-fast) var(--ease-standard);
  }
  .gbp-btn:hover {
    color: var(--color-text-primary);
    background: var(--color-surface-1);
  }
  .gbp-pill {
    /* Pill contract (app.css "Chip contract"): always radius-full + an
       accent border once active, never the inherited `.gbp-btn` radius-sm. */
    border-radius: var(--radius-full);
    border: 1px solid color-mix(in srgb, var(--color-accent) 40%, var(--hairline));
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  }
  .gbp-pill:hover {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 18%, transparent);
  }
  .gbp-label {
    max-width: 8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Forwarded-class contract: `gbp-clear` is a prop on the shared Button
     primitive, so it needs a scoped ancestor + :global() to be reachable.

     TODO(handoff): this × is a Button SIBLING of the Dropdown trigger (never
     a descendant — see the file-header comment on why), so it can't reuse
     app.css's `.chip-x` absolute-position-into-the-pill's-own-reserved-slot
     mechanic without restructuring the DOM (`.gbp-pill`'s own background
     doesn't extend under a reserved slot it doesn't own). It keeps its
     width:0→1rem reveal instead of TagChip's translateX reserve, so the pill
     still widens by ~1rem on hover — same visual FAMILY (radius-full, accent
     hover tint) as the shared chip contract, not a byte-identical copy.
     Proposal: proposals/2026-09-29-hub-chip-contract-followups.md. */
  .gbp :global(.gbp-clear) {
    display: grid;
    place-items: center;
    height: auto;
    min-height: 0;
    width: 0;
    padding: 0;
    margin-inline-start: 0;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-accent);
    opacity: 0;
    overflow: hidden;
    transition:
      opacity var(--duration-fast) var(--ease-enter),
      width var(--duration-fast) var(--ease-enter),
      margin-inline-start var(--duration-fast) var(--ease-enter);
  }
  .gbp :global(.gbp-clear:hover) {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
  }
  .gbp:hover :global(.gbp-clear),
  .gbp:focus-within :global(.gbp-clear) {
    opacity: 1;
    width: 1rem;
    margin-inline-start: var(--space-0-5);
  }
  @media (hover: none) {
    .gbp :global(.gbp-clear) {
      opacity: 1;
      width: 1rem;
      margin-inline-start: var(--space-0-5);
    }
  }
  .gbp-check {
    display: inline-flex;
    width: 1rem;
    flex-shrink: 0;
    justify-content: center;
  }
  .gbp-opt-label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
