<script lang="ts" module>
  // Shape of a single menu row. Exported so the barrel and consumers can type
  // their item arrays. A row is either a real selectable item, or — when
  // `divider` is true — a horizontal separator (other fields ignored).
  // Module-scoped so every Dropdown instance gets a UNIQUE id. (Was an
  // instance-level `let nextId = 0`, so all instances collided on
  // `ui-dropdown-0` → Zag's positioner anchored to the wrong element and menus
  // rendered at the page's top-left. Surfaces only with ≥2 dropdowns per page.)
  let _dropdownSeq = 0;

  export interface DropdownItem {
    value: string;
    label: string;
    /** Optional leading lucide icon component. */
    icon?: any;
    disabled?: boolean;
    /** Render a separator row instead of a selectable item. */
    divider?: boolean;
    /** Destructive styling (red text). */
    danger?: boolean;
    /** Keep the menu open after selecting this item (default: close). */
    closeOnSelect?: boolean;
    /** Render as an <a> linking here instead of a select-only button. */
    href?: string;
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as menu from '@zag-js/menu';
  import { useMachine, normalizeProps, portal } from '@zag-js/svelte';

  type Placement = 'top' | 'bottom' | 'left' | 'right';

  interface Props {
    /** Trigger button content (rendered inside the Zag-wired <button>). */
    trigger: Snippet;
    items: DropdownItem[];
    onSelect?: (value: string) => void;
    placement?: Placement;
    /** Optional custom item renderer (overrides the default row markup). */
    item?: Snippet<[{ item: DropdownItem; highlighted: boolean }]>;
    /** Passthrough class for the floating content panel. */
    class?: string;
  }

  let {
    trigger,
    items,
    onSelect,
    placement = 'bottom',
    item: itemSnippet,
    class: cls = '',
  }: Props = $props();

  const menuId = `ui-dropdown-${_dropdownSeq++}`;

  const service = useMachine(menu.machine as any, () => ({
    id: menuId,
    positioning: { placement: `${placement}-start` as any },
    onSelect({ value }: { value: string }) {
      onSelect?.(value);
    },
  }));
  const api = $derived(menu.connect(service as any, normalizeProps));

  // Zag tracks which item is highlighted on the machine state; expose it so a
  // custom `item` snippet can mirror the default highlight styling.
  const highlightedValue = $derived((api as any).highlightedValue as string | null);
</script>

<button
  {...api.getTriggerProps()}
  class="inline-flex items-center bg-transparent border-none p-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-[var(--radius-md)]"
>
  {@render trigger()}
</button>

<div use:portal {...api.getPositionerProps()} class="z-50">
  <div
    {...api.getContentProps()}
    class="min-w-40 surface-3 rounded-[var(--radius-md)] p-1 outline-none {cls}"
  >
    {#each items as it (it.value)}
      {#if it.divider}
        <div {...api.getSeparatorProps()} class="my-1 h-px bg-[var(--hairline)]"></div>
      {:else}
        <svelte:element
          this={it.href ? 'a' : 'button'}
          href={it.href}
          {...api.getItemProps({
            value: it.value,
            disabled: it.disabled,
            closeOnSelect: it.closeOnSelect,
          })}
          class="flex w-full items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-sm text-left no-underline bg-transparent border-none cursor-pointer outline-none transition-colors
            data-[highlighted]:bg-white/[0.06]
            data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed
            {it.danger ? 'text-destructive' : 'text-foreground'}"
        >
          {#if itemSnippet}
            {@render itemSnippet({ item: it, highlighted: highlightedValue === it.value })}
          {:else}
            {#if it.icon}
              {@const Icon = it.icon}
              <Icon size={14} class={it.danger ? 'text-destructive' : 'text-muted-foreground'} />
            {/if}
            <span class="flex-1">{it.label}</span>
          {/if}
        </svelte:element>
      {/if}
    {/each}
  </div>
</div>
