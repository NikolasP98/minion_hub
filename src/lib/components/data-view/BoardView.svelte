<script lang="ts" generics="T">
  /**
   * Board (kanban) renderer: one column per group, cards in each, the card
   * itself a snippet the page owns. Groups come from the page (`columns`) so
   * an empty option still shows as an empty column — unlike `/pos/catalog`'s
   * board, where only groups with rows exist. Rows with no group land in the
   * trailing "unclassified" column. With `onmove`, every card carries a
   * "Move to…" menu (the baseline path: keyboard and tap) and drags between
   * columns as the pointer enhancement (native HTML5 drag) — both perform the
   * same single write. After a move the card keeps focus in its new column and
   * the shared announcer says what happened (HC-015).
   *
   * Keyboard drag (spec 152): Space on a card picks it up (Enter too when the
   * card has nothing to open), Left / Right choose the column, Space or Enter
   * drops, Escape cancels. Cards have no order inside a column, so Up / Down
   * do nothing.
   *
   * Opt-in for boards that are not a full page (spec 146, the session task
   * board): `fit` shares the width between the columns instead of scrolling
   * sideways; `unclassified={false}` drops the "unset" column and move target
   * when every row always has a column; and without `onopen` a card is a plain
   * block, not a button that does nothing.
   */
  import RecordContextMenu from '$lib/records/RecordContextMenu.svelte';
  import { recordActions, type RecordAction } from '$lib/records/actions';
  import { ArrowUpRight } from 'lucide-svelte';
  import { tick, type Snippet } from 'svelte';
  import { ArrowRightLeft } from 'lucide-svelte';
  import { Button, Dropdown, EmptyState, Tooltip, iconSizes } from '$lib/components/ui';
  import { observeTruncation } from '$lib/components/ui/truncation';
  import { announce } from '$lib/a11y/announce';
  import * as m from '$lib/paraglide/messages';

  let {
    columns,
    rows,
    columnOf,
    rowKey,
    card,
    onopen,
    onmove,
    contextActions,
    rowLabel = rowKey,
    unclassifiedLabel = m.cal_sub_unset(),
    emptyMessage,
    fit = false,
    unclassified = true,
  }: {
    columns: readonly { id: string; label: string; color?: string | null }[];
    rows: readonly T[];
    /** The column a row sits in; `null` = unclassified. */
    columnOf: (row: T) => string | null;
    rowKey: (row: T) => string;
    card: Snippet<[T]>;
    onopen?: (row: T) => void;
    contextActions?: (row: T) => RecordAction[];
    /** Present = cards move between columns (menu + drag); `null` target =
     *  unclassified. Resolving `false` (or throwing) = the write was refused. */
    onmove?: (row: T, columnId: string | null) => void | boolean | Promise<void | boolean>;
    /** What the live region calls a row ("<label> moved to <column>"). */
    rowLabel?: (row: T) => string;
    unclassifiedLabel?: string;
    /** Overrides the empty-board title when `rows.length === 0`. */
    emptyMessage?: string;
    /** Columns share the available width (no horizontal scroll). */
    fit?: boolean;
    /** `false` = every row always has a column: no "unset" column or move target. */
    unclassified?: boolean;
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
  const showUnclassified = $derived(unclassified && (grouped.get(null)?.length ?? 0) > 0);

  /** Column titles that are actually cut off (HC-023): only those get the
   *  shared Tooltip, opened by hover, tap or focus — never a native `title`. */
  let truncated = $state<Record<string, boolean>>({});
  const setTruncated = (key: string, t: boolean) => {
    if (!!truncated[key] !== t) truncated[key] = t;
  };

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
    await moveTo(row, id);
  }

  /** `DropdownItem.value` is a string; the unclassified target rides on a sentinel. */
  const UNSET = '\0unset';
  const moveItems = (row: T) =>
    [...columns, ...(unclassified ? [{ id: UNSET, label: unclassifiedLabel }] : [])].map((c) => ({
      value: c.id,
      label: c.label,
      disabled: (columnOf(row) ?? UNSET) === c.id,
    }));
  const columnLabel = (id: string | null) =>
    columns.find((c) => c.id === id)?.label ?? unclassifiedLabel;
  let board = $state<HTMLElement | null>(null);

  const uid = $props.id();
  const hintId = `${uid}-keyboard-hint`;
  /** Keyboard drag: the picked-up card and the column it is held over. */
  let held = $state<{ key: string; target: string | null } | null>(null);
  /** Space also clicks a button; the click that follows a pick-up or drop is swallowed. */
  let swallowClick = false;
  const targets = $derived<(string | null)[]>([
    ...columns.map((c) => c.id),
    ...(unclassified ? [null] : []),
  ]);
  /** A row's column as the board shows it (an unknown id sits in "unset"). */
  const shownColumn = (row: T) => {
    const id = columnOf(row);
    return id !== null && columns.some((c) => c.id === id) ? id : null;
  };
  function release(row: T, cancelled: boolean) {
    held = null;
    over = undefined;
    if (cancelled) announce(m.board_move_cancelled({ label: rowLabel(row) }), 'assertive');
  }
  function cardKeydown(e: KeyboardEvent, row: T) {
    if (!onmove || !(e.target as HTMLElement).closest('.bcard')) return;
    const key = rowKey(row);
    const label = rowLabel(row);
    if (held?.key !== key) {
      if (e.key !== ' ' && !(e.key === 'Enter' && !onopen)) return;
      e.preventDefault();
      swallowClick = true;
      const target = shownColumn(row);
      held = { key, target };
      over = target;
      announce(m.board_picked_up({ label, column: columnLabel(target) }), 'assertive');
      return;
    }
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const i = targets.indexOf(held.target) + (e.key === 'ArrowRight' ? 1 : -1);
        const target = targets[Math.min(targets.length - 1, Math.max(0, i))];
        held = { key, target };
        over = target;
        announce(m.board_over_column({ label, column: columnLabel(target) }), 'assertive');
        return;
      }
      // TODO(handoff): Up / Down should reorder inside the column (owner decision 2026-11-20),
      // but boards store no order within a column: it needs an order field and an `onreorder`
      // write. Ledger item 17, meta proposals/2026-11-20-hub-accessibility-program.md.
      case 'ArrowUp':
      case 'ArrowDown':
        e.preventDefault();
        return;
      case ' ':
      case 'Enter': {
        e.preventDefault();
        swallowClick = true;
        const target = held.target;
        const stays = target === shownColumn(row);
        release(row, stays);
        if (!stays) void moveTo(row, target);
        return;
      }
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        release(row, true);
        return;
    }
  }
  /** The suppression ends with the key press that started it: a browser that fires no click
   *  for a prevented Space must not leave the NEXT Enter on the card swallowed. */
  function cardKeyup() {
    if (swallowClick) setTimeout(() => (swallowClick = false));
  }
  function cardClickCapture(e: MouseEvent) {
    if (!swallowClick) return;
    swallowClick = false;
    // Only the click a Space / Enter press synthesises (detail 0), never a real pointer click.
    if (e.detail === 0 && (e.target as HTMLElement).closest('.bcard')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
  /** ONE write, whatever opened it (menu or drop); then the card keeps focus in
   *  its new column and the live region says so. */
  async function moveTo(row: T, id: string | null) {
    const key = rowKey(row);
    // A keyboard drag ends on the card; a menu move ends on the menu trigger, as before.
    const fromCard = !!document.activeElement?.closest('.bcard');
    let ok: boolean;
    try {
      ok = (await onmove?.(row, id)) !== false;
    } catch {
      ok = false;
    }
    const label = rowLabel(row);
    announce(
      ok ? m.board_moved_to({ label, column: columnLabel(id) }) : m.board_move_failed({ label }),
    );
    await tick();
    // The card's own button when it has one, else its "Move to…" trigger.
    const card = fromCard ? '.bcard[tabindex], ' : '';
    board
      ?.querySelector<HTMLElement>(
        `[data-row-key="${CSS.escape(key)}"] :is(${card}button.bcard, a.bcard, [data-scope="menu"][data-part="trigger"])`,
      )
      ?.focus({ preventScroll: true });
  }

  function cardActions(row: T): RecordAction[] {
    return [
      ...(onopen
        ? [
            {
              id: 'open',
              label: m.record_open_page(),
              icon: ArrowUpRight,
              run: () => onopen?.(row),
            },
          ]
        : []),
      ...(onmove
        ? [
            {
              id: 'move',
              label: m.board_move_to(),
              icon: ArrowRightLeft,
              children: recordActions(moveItems(row), (value) => {
                void moveTo(row, value === UNSET ? null : value);
              }),
            },
          ]
        : []),
      ...(contextActions?.(row) ?? []),
    ];
  }
</script>

{#if rows.length === 0}
  <EmptyState title={emptyMessage ?? m.board_empty()} />
{:else}
  <div
    class="board"
    class:is-fit={fit}
    class:is-dragging={dragging !== null}
    bind:this={board}
    data-component="board-view"
  >
    {#if onmove}<span id={hintId} class="sr-only">{m.board_keyboard_hint()}</span>{/if}
    {#each [...columns.map( (c) => ({ ...c, key: c.id as string | null }) ), ...(showUnclassified ? [{ id: null, key: null, label: unclassifiedLabel, color: null }] : [])] as col (col.key)}
      {@const titleKey = col.key ?? '\u0000'}
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
          <Tooltip label={col.label} asChild tapToOpen disabled={!truncated[titleKey]}>
            {#snippet children(trigger)}
              <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
              <span
                {...trigger ?? {}}
                class="btitle truncate"
                tabindex="0"
                use:observeTruncation={(t) => setTruncated(titleKey, t)}>{col.label}</span
              >
            {/snippet}
          </Tooltip>
          <span class="bcount">{grouped.get(col.key)?.length ?? 0}</span>
        </header>
        <div class="bcards">
          {#each grouped.get(col.key) ?? [] as row (rowKey(row))}
            <!-- The card is a group: the open Button, then (with `onmove`) the
               "Move to…" menu trigger beside it — never inside it (no
               button-in-button). `draggable` on the group is the pointer
               enhancement, exactly like the calendar's event boxes. -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <RecordContextMenu actions={cardActions(row)}>
              <div
                class="bcard-wrap"
                class:is-dragging={dragging === row || held?.key === rowKey(row)}
                data-row-key={rowKey(row)}
                draggable={!!onmove}
                onkeydown={(e: KeyboardEvent) => cardKeydown(e, row)}
                onkeyup={cardKeyup}
                onclickcapture={cardClickCapture}
                onfocusout={(e: FocusEvent) => {
                  const wrap = e.currentTarget as HTMLElement;
                  if (held?.key === rowKey(row) && !wrap.contains(e.relatedTarget as Node | null))
                    release(row, true);
                }}
                ondragstart={(e: DragEvent) => dragStart(e, row)}
                ondragend={() => ((dragging = null), (over = undefined))}
              >
                {#if onopen}
                  <Button
                    variant="ghost"
                    size="sm"
                    class="bcard"
                    aria-describedby={onmove ? hintId : undefined}
                    onclick={() => onopen?.(row)}
                  >
                    {@render card(row)}
                  </Button>
                {:else if onmove}
                  <!-- Nothing to open: the card itself is the pick-up control. -->
                  <div
                    class="bcard bcard-static"
                    role="button"
                    tabindex="0"
                    aria-pressed={held?.key === rowKey(row)}
                    aria-describedby={hintId}
                  >
                    {@render card(row)}
                  </div>
                {:else}
                  <div class="bcard bcard-static">{@render card(row)}</div>
                {/if}
                {#if onmove}
                  <Dropdown
                    items={moveItems(row)}
                    onSelect={(v) => moveTo(row, v === UNSET ? null : v)}
                    class="bmove-menu"
                  >
                    {#snippet trigger()}
                      <ArrowRightLeft size={iconSizes.sm} aria-hidden="true" />
                      <span class="sr-only">{m.board_move_to()}</span>
                    {/snippet}
                  </Dropdown>
                {/if}
              </div>
            </RecordContextMenu>
          {/each}
        </div>
      </section>
    {/each}
  </div>
{/if}

<style>
  .board {
    position: relative; /* anchors the sr-only live region inside the scroll region */
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    overflow-x: auto;
    /* Flex items default to min-width:auto, so the board pushed the page
       wider instead of scrolling inside it; the gutter keeps the page's side
       margin visible at both scroll ends. */
    padding-inline: var(--space-page-gutter);
    padding-bottom: var(--space-2);
    min-width: 0;
    min-height: 0;
    flex: 1;
  }
  /* `fit`: an embedded board. The host owns the gutter; columns share the width. */
  .board.is-fit {
    overflow-x: visible;
    padding-inline: 0;
    padding-bottom: 0;
    align-items: stretch;
  }
  .board.is-fit .bcol {
    flex: 1 1 0;
    min-width: 0;
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
  /* The card group: open Button + move trigger side by side. Cards never
     shrink — the column scrolls. */
  .bcard-wrap {
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
    flex-shrink: 0;
  }
  .bcard-wrap.is-dragging {
    opacity: 0.5;
  }
  .bcard-wrap :global([data-scope='menu'][data-part='trigger']) {
    flex-shrink: 0;
    padding: 0 var(--space-1);
    min-width: var(--control-height-sm);
    justify-content: center;
    color: var(--color-text-tertiary);
    border-radius: var(--radius-md);
  }
  .bcard-wrap :global([data-scope='menu'][data-part='trigger']:hover) {
    color: var(--color-text-primary);
    background: var(--color-surface-2);
  }
  /* Card-shaped Button: the primitive's inner row span must stack (governance
     "Button slot trap"). */
  .bcards :global(.bcard) {
    height: auto;
    flex: 1;
    min-width: 0;
    justify-content: flex-start;
    text-align: left;
    padding: var(--space-2) var(--space-3);
    background: var(--color-surface-2);
    border: 1px solid var(--color-border);
  }
  .bcards :global(:is(button, a).bcard > span) {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
    gap: var(--space-0-5);
  }
  /* A card with nothing to open: same surface, not a control. */
  .bcard-static {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    border-radius: var(--radius-md);
    font-size: var(--font-size-caption);
  }
  @media (pointer: coarse) {
    .bcard-wrap :global([data-scope='menu'][data-part='trigger']) {
      min-width: var(--control-height-touch);
    }
  }
</style>
