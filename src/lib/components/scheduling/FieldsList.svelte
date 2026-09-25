<script lang="ts">
  /**
   * The calendar's field-layout list: one checkbox row per field plus a drag
   * handle to reorder — the `DataTable` column-menu idiom, shared by the hover
   * card's "Card fields" menu and the kebab panel's "Event block" section so
   * the two configure identically.
   *
   * It renders INLINE (no `Popover` of its own): inside the hover card a
   * portalled panel would leave the interactive Zag tooltip and close the whole
   * card, and inside the kebab it is already in a popover. Dismissal therefore
   * belongs to the host.
   *
   * Drag state is local — two lists never drag into each other — and the host
   * only hears the committed `onmove(from, to)`.
   */
  import { Check, GripVertical } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';

  let {
    heading,
    fields,
    hidden,
    order,
    ontoggle,
    onmove,
    lockedKeys = [],
  }: {
    heading: string;
    /** Label per key; `order` decides the rows' sequence. */
    fields: Array<{ key: string; label: string }>;
    hidden: ReadonlySet<string>;
    order: string[];
    ontoggle: (key: string) => void;
    onmove: (from: string, to: string) => void;
    /** Rows that are toggle-only: no drag handle, not a drag source or target
     *  (their slot is fixed — e.g. a head-slot badge or a corner tag cluster). */
    lockedKeys?: string[];
  } = $props();

  let dragKey = $state<string | null>(null);

  const labelOf = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
  const locked = (key: string) => lockedKeys.includes(key);

  function drop(target: string) {
    if (dragKey) onmove(dragKey, target);
    dragKey = null;
  }
</script>

<div class="hc-fields">
  <div class="t-caption hc-fields-h">{heading}</div>
  {#each order as f (f)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="hc-field"
      class:dragging={dragKey === f}
      draggable={!locked(f)}
      ondragstart={() => (dragKey = f)}
      ondragover={locked(f) ? undefined : (e) => e.preventDefault()}
      ondrop={locked(f) ? undefined : () => drop(f)}
    >
      {#if !locked(f)}
        <GripVertical size={iconSizes.xs} class="hc-grip" />
      {/if}
      <Button
        variant="ghost"
        size="xs"
        class="hc-field-btn"
        aria-pressed={!hidden.has(f)}
        onclick={() => ontoggle(f)}
      >
        <span class="hc-check" class:on={!hidden.has(f)}>
          {#if !hidden.has(f)}<Check size={iconSizes.xs} />{/if}
        </span>
        <span class="hc-field-label">{labelOf(f)}</span>
      </Button>
    </div>
  {/each}
</div>

<style>
  .hc-fields {
    display: flex;
    flex-direction: column;
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: var(--space-1);
    /* The hover card is a 2-track grid whose blocks span both columns. Its own
       `.hover-card > *` rule cannot reach a component root (Svelte scoping
       never tags another component's root), so the span is declared here;
       it is inert inside the kebab panel's flex column. */
    grid-column: 1 / -1;
  }
  .hc-fields-h {
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-text-tertiary);
    padding: var(--space-0-5) var(--space-1);
  }
  .hc-field {
    display: grid;
    grid-template-columns: var(--space-3) minmax(0, 1fr);
    align-items: center;
    border-radius: var(--radius-sm);
  }
  .hc-field:hover {
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }
  .hc-field.dragging {
    opacity: 0.5;
  }
  .hc-field :global(.hc-grip) {
    color: var(--color-text-tertiary);
    cursor: grab;
  }
  .hc-field :global(.hc-field-btn) {
    grid-column: 2;
    height: auto;
    min-height: 0;
    padding: var(--space-0-5) var(--space-1);
    justify-content: flex-start;
  }
  .hc-field :global(.hc-field-btn > span) {
    width: 100%;
    justify-content: flex-start;
    gap: var(--space-2);
  }
  /* Selection-control contract: 1rem border-box in BOTH states. */
  .hc-check {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-xs);
    background: var(--color-surface-2);
    color: var(--color-on-accent);
  }
  .hc-check.on {
    background: var(--color-accent);
    border-color: var(--color-accent);
  }
  .hc-field:hover .hc-check {
    border-color: var(--color-accent);
  }
  .hc-field-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
