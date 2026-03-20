<script lang="ts" generics="T">
  import { tick } from 'svelte';
  import type { Snippet } from 'svelte';
  import * as combobox from '@zag-js/combobox';
  import { useMachine, normalizeProps } from '@zag-js/svelte';

  interface Props {
    /** Unique ID for the combobox machine */
    id: string;
    /** Items to display in the dropdown */
    items: T[];
    /** Extract the unique value string from an item */
    itemToValue: (item: T) => string;
    /** Extract the display string from an item */
    itemToString: (item: T) => string;
    /** Input placeholder */
    placeholder?: string;
    /** Currently selected value (bindable) */
    value?: string;
    /** Called when selection changes */
    onValueChange?: (value: string) => void;
    /** Optional label above the input */
    label?: string;
    /** Custom item rendering snippet */
    item?: Snippet<[{ item: T; selected: boolean; itemTextProps: Record<string, any> }]>;
  }

  let {
    id: comboboxId,
    items,
    itemToValue,
    itemToString,
    placeholder = 'Search\u2026',
    value = $bindable(''),
    onValueChange,
    label,
    item: itemSnippet,
  }: Props = $props();

  // ── Internal filter state ───────────────────────────────────────────────
  let filterQuery = $state('');

  const filteredItems = $derived(
    filterQuery.trim()
      ? items.filter((item) => {
          const q = filterQuery.toLowerCase();
          return (
            itemToString(item).toLowerCase().includes(q) ||
            itemToValue(item).toLowerCase().includes(q)
          );
        })
      : items,
  );

  // ── Zag.js combobox machine ─────────────────────────────────────────────
  const collection = $derived(
    combobox.collection({
      items: filteredItems,
      itemToValue,
      itemToString,
    }),
  );

  const service = useMachine(combobox.machine, () => ({
    id: comboboxId,
    collection,
    placeholder,
    selectionBehavior: 'replace' as const,
    openOnClick: true,
    openOnChange: true,
    positioning: { placement: 'bottom-start' as const },
    onInputValueChange({ inputValue }: { inputValue: string }) {
      filterQuery = inputValue;
    },
    onValueChange({ value: vals }: { value: string[] }) {
      value = vals[0] ?? '';
      onValueChange?.(value);
    },
    onOpenChange({ open, value: vals }: { open: boolean; value: string[] }) {
      if (!open) {
        // Revert input text to the selected item's display name
        const currentVal = vals[0] ?? null;
        if (currentVal) {
          const found = items.find((i) => itemToValue(i) === currentVal);
          if (found) {
            queueMicrotask(() => {
              filterQuery = '';
              api.setInputValue(itemToString(found));
            });
          }
        } else {
          queueMicrotask(() => {
            filterQuery = '';
            api.setInputValue('');
          });
        }
      }
    },
  }));

  const api = $derived(combobox.connect(service, normalizeProps));

  // ── Chevron handlers ────────────────────────────────────────────────────
  function handleChevronPointerDown(e: PointerEvent) {
    if (e.pointerType === 'touch') return;
    if (e.button !== 0) return;
    e.preventDefault(); // keep focus on input
  }

  function handleChevronClick() {
    if (!api.open) {
      filterQuery = '';
      api.setInputValue('');
      api.setOpen(true, 'trigger-click');
    } else {
      api.setOpen(false, 'trigger-click');
    }
  }

  // ── Sync external value into combobox ───────────────────────────────────
  // Track both value and items so this re-runs when async items load.
  // Use tick() to wait for useMachine to flush the new collection to the
  // zag machine before calling setValue.
  $effect(() => {
    const v = value;
    const currentItems = items;
    if (v && currentItems.length > 0) {
      tick().then(() => {
        if (api.value[0] !== v) {
          api.setValue([v]);
          const found = currentItems.find((i) => itemToValue(i) === v);
          if (found) {
            api.setInputValue(itemToString(found));
          }
        }
      });
    }
  });
</script>

<div {...api.getRootProps()}>
  {#if label}
    <label class="cb-label" {...api.getLabelProps()}>{label}</label>
  {/if}

  <div class="cb-control" {...api.getControlProps()}>
    <input class="cb-input" {...api.getInputProps()} />
    <button
      type="button"
      class="cb-chevron"
      tabindex={-1}
      aria-label="Toggle list"
      aria-haspopup="listbox"
      aria-expanded={api.open}
      data-state={api.open ? 'open' : 'closed'}
      onclick={handleChevronClick}
      onpointerdown={handleChevronPointerDown}
    >
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M4 6l4 4 4-4" />
      </svg>
    </button>
  </div>

  <div class="cb-positioner" {...api.getPositionerProps()}>
    <div class="cb-content" {...api.getContentProps()}>
      <ul class="cb-list" {...api.getListProps()}>
        {#each filteredItems as listItem (itemToValue(listItem))}
          <li class="cb-item" {...api.getItemProps({ item: listItem })}>
            {#if itemSnippet}
              {@render itemSnippet({
                item: listItem,
                selected: api.value.includes(itemToValue(listItem)),
                itemTextProps: api.getItemTextProps({ item: listItem }),
              })}
            {:else}
              <span
                class="cb-item-text"
                class:cb-item-selected={api.value.includes(itemToValue(listItem))}
                {...api.getItemTextProps({ item: listItem })}
              >
                {itemToString(listItem)}
              </span>
            {/if}
          </li>
        {/each}
        {#if filteredItems.length === 0}
          <li class="cb-empty">No matches</li>
        {/if}
      </ul>
    </div>
  </div>
</div>

<style>
  /* ── Label ────────────────────────────────────────────────────────────── */
  .cb-label {
    display: block;
    font-size: 12px;
    font-weight: 600;
    color: var(--color-foreground);
    margin-bottom: 4px;
  }

  /* ── Control (input + chevron) ────────────────────────────────────────── */
  .cb-control {
    display: flex;
    align-items: center;
    background: var(--color-bg2);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .cb-control:focus-within {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
  }

  .cb-input {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--color-foreground);
    font-family: inherit;
    font-size: 13px;
    padding: 8px 10px;
  }
  .cb-input::placeholder {
    color: var(--color-muted);
  }

  .cb-chevron {
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--color-muted);
    cursor: pointer;
    padding: 0 8px;
    align-self: stretch;
    flex-shrink: 0;
    transition: color 0.15s;
  }
  .cb-chevron:hover {
    color: var(--color-foreground);
  }
  .cb-chevron[data-state='open'] svg {
    transform: rotate(180deg);
  }
  .cb-chevron svg {
    transition: transform 0.15s;
  }

  /* ── Dropdown ─────────────────────────────────────────────────────────── */
  .cb-positioner {
    z-index: 2000;
  }
  .cb-positioner[data-state='closed'] {
    display: none;
  }

  .cb-content {
    background: var(--color-bg2);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }

  .cb-list {
    list-style: none;
    margin: 0;
    padding: 4px;
    max-height: 220px;
    overflow-y: auto;
  }

  /* ── Items ─────────────────────────────────────────────────────────────── */
  .cb-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.1s;
  }
  .cb-item[data-highlighted] {
    background: var(--color-bg3, var(--color-bg));
  }

  /* Default item text (when no snippet provided) */
  .cb-item-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-foreground);
  }
  .cb-item-selected {
    color: var(--color-accent);
    font-weight: 600;
  }

  .cb-empty {
    padding: 8px;
    color: var(--color-muted);
    font-size: 12px;
    font-style: italic;
  }
</style>
