<script lang="ts" module>
  /** One row. `children` opens ONE nested level — a submenu of a submenu is not
   *  a context menu, it is a maze. */
  export interface ContextMenuItem {
    id: string;
    label: string;
    disabled?: boolean;
    danger?: boolean;
    children?: ContextMenuItem[];
  }
</script>

<script lang="ts">
  /**
   * A POINT-anchored menu: it opens where the pointer is, not under a trigger,
   * which is why `Dropdown`/`Popover` (both trigger-anchored Zag machines)
   * cannot serve it. Positioning, outside-click and Escape behaviour are
   * `DataTable`'s header context menu, lifted into a primitive so the calendar
   * does not start a third copy.
   *
   * The host owns open/closed: it renders `<ContextMenu>` only while a menu is
   * wanted AND has ≥ 1 item (`{#if at && items.length}`) — there is no empty
   * guard here, and an item-less menu paints a thin blank box. Entries must be
   * ready at open: never a "Cargando…" placeholder row (owner 2026-10-13).
   *
   * a11y: `role="menu"` / `role="menuitem"`, `aria-haspopup`/`aria-expanded` on
   * a submenu parent, first item focused on open, Up/Down to walk the rows,
   * Right/Left to open/close the submenu, Enter/Space to pick, Escape or Tab to
   * close (Tab closing is what a native menu does — there is nowhere to tab to).
   */
  import { tick } from 'svelte';
  import { floatingLayer } from './floating-layer.svelte';

  interface Props {
    /** Viewport coordinates (a `MouseEvent`'s `clientX`/`clientY`). */
    x: number;
    y: number;
    items: ContextMenuItem[];
    /** Accessible name for the menu. */
    label: string;
    onselect: (item: ContextMenuItem) => void;
    onclose: () => void;
  }

  let { x, y, items, label, onselect, onclose }: Props = $props();

  /** Both panels are `min-width: 12rem`; 16px/rem is the app's root size. */
  const PANEL_PX = 12 * 16;

  let root = $state<HTMLDivElement | null>(null);
  /** Which submenu is open, by parent item id. */
  let openSub = $state<string | null>(null);
  /** Clamped position — measured once mounted (and again when the item list
   *  changes), so a menu opened near the right or bottom edge flips back inside
   *  instead of being cut off. `null` until measured: the first paint uses the
   *  raw pointer coordinates, which is already right everywhere but the edges. */
  let clamped = $state<{ x: number; y: number } | null>(null);
  const pos = $derived(clamped ?? { x, y });
  /** A submenu flies out to the LEFT of its parent when there is no room on the
   *  right for a second panel. */
  let subFlip = $state(false);

  $effect(() => {
    if (!root) return;
    // Re-measured when the list changes (a submenu opening, a host swapping items).
    items.length;
    const { offsetWidth: w, offsetHeight: h } = root;
    clamped = {
      x: Math.max(0, x + w > window.innerWidth ? x - w : x),
      y: Math.max(0, y + h > window.innerHeight ? y - h : y),
    };
    subFlip = x + PANEL_PX * 2 > window.innerWidth;
  });

  // Separate from the measuring effect: re-focusing on every `items` change
  // would steal focus back from a submenu the operator just opened.
  $effect(() => {
    root?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  });

  /** The rows that belong to `menu` itself, not to a submenu nested in it. */
  function rowsIn(menu: HTMLElement): HTMLElement[] {
    return [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(
      (r) => r.closest('[role="menu"]') === menu,
    );
  }

  function step(el: HTMLElement, dir: 1 | -1) {
    const menu = el.closest<HTMLElement>('[role="menu"]');
    if (!menu) return;
    const rows = rowsIn(menu);
    const i = rows.indexOf(el);
    rows[(i + dir + rows.length) % rows.length]?.focus();
  }

  async function openSubmenu(item: ContextMenuItem, parent: HTMLElement) {
    openSub = item.id;
    await tick();
    parent.parentElement?.querySelector<HTMLElement>('[role="menu"] [role="menuitem"]')?.focus();
  }

  function closeSubmenu() {
    const parentId = openSub;
    openSub = null;
    root?.querySelector<HTMLElement>(`[data-item="${parentId}"]`)?.focus();
  }

  function onkeydown(e: KeyboardEvent, item: ContextMenuItem) {
    const el = e.currentTarget as HTMLElement;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        step(el, e.key === 'ArrowDown' ? 1 : -1);
        return;
      case 'ArrowRight':
        if (!item.children?.length) return;
        e.preventDefault();
        void openSubmenu(item, el);
        return;
      case 'ArrowLeft':
        if (!openSub) return;
        e.preventDefault();
        closeSubmenu();
        return;
      case 'Escape':
      case 'Tab':
        e.preventDefault();
        onclose();
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        pick(item, el);
        return;
    }
  }

  function pick(item: ContextMenuItem, el: HTMLElement) {
    if (item.disabled) return;
    if (item.children?.length) {
      if (openSub === item.id) closeSubmenu();
      else void openSubmenu(item, el);
      return;
    }
    onselect(item);
  }

  // Dismissal is document-level, with no fixed backdrop: a backdrop would
  // swallow the right-click that opens the NEXT event's menu.
  function outside(target: EventTarget | null): boolean {
    return !!root && !root.contains(target as Node);
  }
</script>

<svelte:document
  onpointerdown={(e) => outside(e.target) && onclose()}
  onkeydown={(e) => e.key === 'Escape' && onclose()}
  oncontextmenu={(e) => outside(e.target) && onclose()}
/>

<!-- `use:floatingLayer`: one floating layer at a time — see
     `floating-layer.svelte.ts`. Mounted only while the menu is wanted. -->
<div
  bind:this={root}
  use:floatingLayer
  class="ctxm surface-3"
  role="menu"
  aria-label={label}
  tabindex="-1"
  style="left:{pos.x}px; top:{pos.y}px"
>
  {#each items as item (item.id)}
    {#if item.children?.length}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="ctxm-parent" onmouseenter={() => (openSub = item.id)}>
        <button
          type="button"
          role="menuitem"
          class="ctxm-item"
          data-item={item.id}
          aria-haspopup="menu"
          aria-expanded={openSub === item.id}
          onclick={(e) => pick(item, e.currentTarget)}
          onkeydown={(e) => onkeydown(e, item)}
        >
          <span class="ctxm-label">{item.label}</span>
          <span class="ctxm-more" aria-hidden="true">›</span>
        </button>
        {#if openSub === item.id}
          <div class="ctxm-sub surface-3" class:flip={subFlip} role="menu" aria-label={item.label}>
            {#each item.children as child (child.id)}
              <button
                type="button"
                role="menuitem"
                class="ctxm-item"
                class:danger={child.danger}
                data-item={child.id}
                disabled={child.disabled}
                onclick={(e) => pick(child, e.currentTarget)}
                onkeydown={(e) => onkeydown(e, child)}
              >
                <span class="ctxm-label">{child.label}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {:else}
      <button
        type="button"
        role="menuitem"
        class="ctxm-item"
        class:danger={item.danger}
        data-item={item.id}
        disabled={item.disabled}
        onclick={(e) => pick(item, e.currentTarget)}
        onkeydown={(e) => onkeydown(e, item)}
      >
        <span class="ctxm-label">{item.label}</span>
      </button>
    {/if}
  {/each}
</div>

<style>
  .ctxm {
    position: fixed;
    min-width: 12rem;
    padding: var(--space-1);
    border-radius: var(--radius-md);
    outline: none;
    z-index: var(--layer-popover);
  }
  .ctxm-parent {
    position: relative;
  }
  .ctxm-sub {
    position: absolute;
    top: 0;
    left: 100%;
    margin-left: var(--space-1);
    min-width: 12rem;
    padding: var(--space-1);
    border-radius: var(--radius-md);
    z-index: var(--layer-popover);
  }
  .ctxm-sub.flip {
    left: auto;
    right: 100%;
    margin-left: 0;
    margin-right: var(--space-1);
  }
  .ctxm-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
    text-align: left;
    cursor: pointer;
    outline: none;
  }
  .ctxm-item:hover,
  .ctxm-item:focus-visible {
    background: color-mix(in srgb, var(--color-text-primary) 6%, transparent);
  }
  .ctxm-item:focus-visible {
    box-shadow: var(--shadow-focus);
  }
  .ctxm-item:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .ctxm-item.danger {
    color: var(--color-danger-fg);
  }
  .ctxm-label {
    flex: 1;
    min-width: 0;
  }
  .ctxm-more {
    color: var(--color-text-tertiary);
  }
</style>
