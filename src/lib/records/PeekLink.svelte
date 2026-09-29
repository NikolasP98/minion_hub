<script lang="ts">
  /**
   * An `<a href>` that honours a record open mode: plain click → `openRecord`
   * (modal / tray / page); modifier or middle click → the browser's own
   * new-tab behaviour. Custom table cells and detail cards use this for any
   * cross-record link (invoice, product, entry…).
   */
  import type { Snippet } from 'svelte';
  import { openModeFor, peekClick, type OpenMode } from './peek.svelte';

  let {
    href,
    mode,
    tableId,
    class: cls = '',
    children,
    ...rest
  }: {
    href: string;
    /** Explicit mode; wins over `tableId`'s org config. */
    mode?: OpenMode;
    /** Resolve the mode from this table's org config (`openIn`). */
    tableId?: string;
    class?: string;
    children: Snippet;
    [key: string]: unknown;
  } = $props();

  const resolved = $derived(openModeFor(tableId, mode));
</script>

<a {href} class={cls} {...rest} onclick={peekClick(href, resolved)}>{@render children()}</a>
