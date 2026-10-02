<script lang="ts" generics="T">
  /**
   * Board (kanban) renderer: one column per group, cards in each, the card
   * itself a snippet the page owns. Groups come from the page (`columns`) so
   * an empty option still shows as an empty column — unlike `/pos/catalog`'s
   * board, where only groups with rows exist. Rows with no group land in the
   * trailing "unclassified" column. With `onmove`, cards drag between columns
   * (native HTML5 drag; the keyboard path is the card's own open action).
   */
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  let {
    columns,
    rows,
    columnOf,
    rowKey,
    card,
    onopen,
    onmove,
    unclassifiedLabel = m.cal_sub_unset(),
  }: {
    columns: readonly { id: string; label: string; color?: string | null }[];
    rows: readonly T[];
    /** The column a row sits in; `null` = unclassified. */
    columnOf: (row: T) => string | null;
    rowKey: (row: T) => string;
    card: Snippet<[T]>;
    onopen?: (row: T) => void;
    /** Present = cards drag between columns; `null` target = unclassified. */
    onmove?: (row: T, columnId: string | null) => void | Promise<void>;
    unclassifiedLabel?: string;
  } = $props();

  const grouped = $derived.by(() => {
    const ids = new Set(columns.map((c) => c.id));
    const by = new Map<string | null, T[]>([
      ...columns.map((c) => [c.id, [] as T[]] as const),
      [null, []],
    ]);
    for (const r of rows) {
      const id = columnOf(r);
      by.get(id !== null && ids.has(id) ? id : null)!.push(r);
    }
    return by;
  });
  const showUnclassified = $derived((grouped.get(null)?.length ?? 0) > 0);

  let dragging = $state<T | null>(null);
  let over = $state<string | null | undefined>(undefined);
  function dragStart(e: DragEvent, row: T) {
    if (!onmove) return;
    dragging = row;
    e.dataTransfer?.setData('text/plain', rowKey(row));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }
  function dragOver(e: DragEvent, id: string | null) {
    if (!dragging) return;
    e.preventDefault();
    over = id;
  }
  async function drop(id: string | null) {
    const row = dragging;
    dragging = null;
    over = undefined;
    if (!row || columnOf(row) === id) return;
    await onmove?.(row, id);
  }
</script>

<div class="board" class:is-dragging={dragging !== null}>
  {#each [...columns.map( (c) => ({ ...c, key: c.id as string | null }) ), ...(showUnclassified ? [{ id: null, key: null, label: unclassifiedLabel, color: null }] : [])] as col (col.key)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <section
      class="bcol"
      class:is-over={over === col.key}
      aria-label={col.label}
      ondragover={(e) => dragOver(e, col.key)}
      ondragleave={() => (over = undefined)}
      ondrop={() => drop(col.key)}
    >
      <header class="bhead">
        {#if col.color}<span class="dot" style="background:{col.color}"></span>{/if}
        <span class="btitle truncate">{col.label}</span>
        <span class="bcount">{grouped.get(col.key)?.length ?? 0}</span>
      </header>
      <div class="bcards">
        {#each grouped.get(col.key) ?? [] as row (rowKey(row))}
          <!-- The Button is the keyboard path (open); `draggable` is the pointer
               enhancement, exactly like the calendar's event boxes. -->
          <Button
            variant="ghost"
            size="sm"
            class="bcard {dragging === row ? 'is-dragging' : ''}"
            draggable={!!onmove}
            ondragstart={(e: DragEvent) => dragStart(e, row)}
            ondragend={() => ((dragging = null), (over = undefined))}
            onclick={() => onopen?.(row)}
          >
            {@render card(row)}
          </Button>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .board {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    overflow-x: auto;
    padding-bottom: var(--space-2);
    min-height: 0;
    flex: 1;
  }
  .bcol {
    flex: 0 0 16rem;
    display: flex;
    flex-direction: column;
    max-height: 100%;
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    transition: border-color var(--duration-fast) var(--ease-standard);
  }
  .bcol.is-over {
    border-color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 8%, var(--color-surface-1));
  }
  .bhead {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-size-caption);
    font-weight: 600;
    color: var(--color-text-secondary);
    border-bottom: 1px solid var(--color-border);
  }
  .dot {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }
  .btitle {
    flex: 1;
    min-width: 0;
  }
  .bcount {
    color: var(--color-text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .bcards {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2);
    overflow-y: auto;
    min-height: var(--control-height-touch);
  }
  /* Card-shaped Button: the primitive's inner row span must stack (governance
     "Button slot trap"). Cards never shrink — the column scrolls. */
  .bcards :global(.bcard) {
    height: auto;
    flex-shrink: 0;
    justify-content: flex-start;
    text-align: left;
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
  }
  .bcards :global(.bcard > span) {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    gap: var(--space-0-5);
  }
  .bcards :global(.bcard.is-dragging) {
    opacity: 0.5;
  }
</style>
