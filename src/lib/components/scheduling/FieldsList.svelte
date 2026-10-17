<script lang="ts">
  /**
   * The calendar's field-layout list: one checkbox row per field plus a drag
   * handle to reorder — the `DataTable` column-menu idiom, shared by the toolbar
   * kebab's "Card fields" and "Event block" sections so the two configure
   * identically.
   *
   * It renders INLINE (no `Popover` of its own): it is already inside the
   * kebab's popover, so dismissal belongs to the host. It once also rendered
   * inside the hover card — that is exactly what broke (owner, 2026-09-25: "when
   * dragging the elements to reorder, the popover closes and bugs out"), because
   * the card is an interactive Zag tooltip whose close intent fires as soon as
   * the drag leaves the panel. Never mount it inside the card again.
   *
   * Drag state is local — two lists never drag into each other — and the host
   * only hears the committed `onmove(from, to)`.
   */
  import { Check, GripVertical, ArrowUp, ArrowDown } from 'lucide-svelte';
  import { tick } from 'svelte';
  import * as m from '$lib/paraglide/messages';
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
    /** Label per key; `order` decides the rows' sequence. A field's `children`
     *  are sub-items of that one block: they render indented right under their
     *  parent, toggle-only (no handle, no drag), and move with it — the parent's
     *  slot in `order` is the only position either of them has. */
    fields: Array<{ key: string; label: string; children?: Array<{ key: string; label: string }> }>;
    hidden: ReadonlySet<string>;
    order: string[];
    ontoggle: (key: string) => void;
    onmove: (from: string, to: string) => void;
    /** Rows that are toggle-only: no drag handle, not a drag source or target
     *  (their slot is fixed — e.g. a head-slot badge or a corner tag cluster). */
    lockedKeys?: string[];
  } = $props();

  let dragKey = $state<string | null>(null);
  let root: HTMLDivElement;
  let announce = $state('');
  async function move(key: string, direction: -1 | 1) {
    const i = order.indexOf(key);
    const target = order[i + direction];
    if (!target || locked(key) || locked(target)) return;
    if (direction < 0) onmove(key, target);
    else onmove(target, key);
    announce =
      direction < 0
        ? m.design_move_before({ label: labelOf(key) })
        : m.design_move_after({ label: labelOf(key) });
    await tick();
    // Focus stays on a move control (same direction, else the other); a second Enter
    // must never land on the visibility toggle and hide the field.
    const row = root?.querySelector<HTMLElement>(`[data-field-key="${CSS.escape(key)}"]`);
    const moves = [...(row?.querySelectorAll<HTMLButtonElement>('.hc-move button') ?? [])];
    const preferred = direction < 0 ? moves[0] : moves[1];
    (preferred && !preferred.disabled ? preferred : moves.find((b) => !b.disabled))?.focus() ??
      row?.querySelector<HTMLElement>('.hc-field-btn')?.focus();
  }

  const labelOf = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
  const childrenOf = (key: string) => fields.find((f) => f.key === key)?.children ?? [];
  const locked = (key: string) => lockedKeys.includes(key);

  function drop(target: string) {
    if (dragKey) {
      const a = order.indexOf(dragKey);
      const b = order.indexOf(target);
      if (!order.slice(Math.min(a, b), Math.max(a, b) + 1).some(locked)) onmove(dragKey, target);
    }
    dragKey = null;
  }
</script>

{#snippet toggle(key: string, label: string, disabled = false)}
  <Button
    variant="ghost"
    size="xs"
    class="hc-field-btn"
    aria-pressed={!hidden.has(key)}
    {disabled}
    title={disabled ? m.design_parent_hidden() : undefined}
    onclick={() => ontoggle(key)}
  >
    <span class="hc-check" class:on={!hidden.has(key)}>
      {#if !hidden.has(key)}<Check size={iconSizes.xs} />{/if}
    </span>
    <span class="hc-field-label">{label}</span>
  </Button>
{/snippet}

<div class="hc-fields" bind:this={root}>
  <span class="sr-only" aria-live="polite">{announce}</span>
  {#if heading}<div class="t-caption hc-fields-h">{heading}</div>{/if}
  {#each order as f (f)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="hc-field"
      data-field-key={f}
      class:dragging={dragKey === f}
      draggable={!locked(f)}
      ondragstart={() => (dragKey = f)}
      ondragover={locked(f) ? undefined : (e) => e.preventDefault()}
      ondrop={locked(f) ? undefined : () => drop(f)}
    >
      {#if !locked(f)}
        <GripVertical size={iconSizes.xs} class="hc-grip" />
      {/if}
      {@render toggle(f, labelOf(f))}
      {#if !locked(f)}
        <div class="hc-move">
          <Button
            variant="ghost"
            size="xs"
            aria-label={m.design_move_before({ label: labelOf(f) })}
            disabled={order.indexOf(f) === 0 || locked(order[order.indexOf(f) - 1])}
            onclick={() => move(f, -1)}><ArrowUp size={iconSizes.xs} /></Button
          >
          <Button
            variant="ghost"
            size="xs"
            aria-label={m.design_move_after({ label: labelOf(f) })}
            disabled={order.indexOf(f) === order.length - 1 || locked(order[order.indexOf(f) + 1])}
            onclick={() => move(f, 1)}><ArrowDown size={iconSizes.xs} /></Button
          >
        </div>
      {/if}
    </div>
    {#each childrenOf(f) as c (c.key)}
      <div class="hc-field hc-field-sub">{@render toggle(c.key, c.label, hidden.has(f))}</div>
    {/each}
  {/each}
</div>

<style>
  .hc-move {
    display: flex;
    gap: var(--space-0-5);
  }
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
    grid-template-columns: var(--space-3) minmax(0, 1fr) auto;
    align-items: center;
    border-radius: var(--radius-sm);
  }
  .hc-field:hover {
    background: color-mix(in srgb, var(--color-accent) 8%, transparent);
  }
  .hc-field.dragging {
    opacity: 0.5;
  }
  /* Sub-item row: indented under its parent, no handle column to fill. */
  .hc-field-sub {
    padding-left: var(--space-3);
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
