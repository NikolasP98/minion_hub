<script lang="ts" module>
  import type { PreviewValue } from './color-source-preview';

  export interface ColorSourceOption {
    value: string;
    label: string;
    /** The table/entity the colour comes from, as the app names it to users. */
    source: string;
    /** Values the column can paint — the hover/focus preview. Empty = no preview. */
    values: PreviewValue[];
  }
</script>

<script lang="ts">
  /**
   * One colour-source choice for the calendar's kebab panel. A native select
   * element cannot preview its options, so this is a listbox: every row carries the
   * column's label plus, subtly, WHERE the colour comes from (owner directive
   * 2026-09-25: "add the table name next to the field … for the user to know
   * what they're choosing and from where"), and hovering or focusing a row opens
   * a `Tooltip` listing that column's values with their colours.
   *
   * Roving tabindex (the selected option is the tab stop, arrows move DOM focus)
   * rather than `aria-activedescendant`: real focus is what makes the Zag
   * tooltip open for keyboard users too.
   */
  import { Tooltip } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { capPreview } from './color-source-preview';

  let {
    label,
    value,
    onchange,
    options,
  }: {
    label: string;
    value: string;
    onchange: (value: string) => void;
    options: ColorSourceOption[];
  } = $props();

  const uid = $props.id();
  const labelId = `csp-${uid}`;

  /** Options are the only `[role=option]`s inside the list, so a query is enough
   *  — no per-row refs to keep in sync. */
  function move(from: HTMLElement, delta: number | 'first' | 'last') {
    const opts = [
      ...(from.closest('[role="listbox"]')?.querySelectorAll<HTMLElement>('[role="option"]') ?? []),
    ];
    if (opts.length === 0) return;
    const at = opts.indexOf(from);
    const next =
      delta === 'first'
        ? 0
        : delta === 'last'
          ? opts.length - 1
          : (at + delta + opts.length) % opts.length;
    opts[next]?.focus();
  }

  function onkeydown(event: KeyboardEvent, option: ColorSourceOption) {
    const el = event.currentTarget as HTMLElement;
    switch (event.key) {
      case 'ArrowDown':
        move(el, 1);
        break;
      case 'ArrowUp':
        move(el, -1);
        break;
      case 'Home':
        move(el, 'first');
        break;
      case 'End':
        move(el, 'last');
        break;
      case 'Enter':
      case ' ':
        onchange(option.value);
        break;
      default:
        return;
    }
    event.preventDefault();
  }
</script>

<div class="csp">
  <span class="t-caption csp-label" id={labelId}>{label}</span>
  <div class="csp-list" role="listbox" aria-labelledby={labelId}>
    {#each options as option (option.value)}
      {@const preview = capPreview(option.values)}
      <Tooltip placement="right" disabled={preview.shown.length === 0} asChild>
        {#snippet children(trigger)}
          <div
            {...trigger}
            role="option"
            aria-selected={option.value === value}
            tabindex={option.value === value ? 0 : -1}
            class="csp-opt"
            class:is-on={option.value === value}
            onclick={() => onchange(option.value)}
            onkeydown={(event) => onkeydown(event, option)}
          >
            <span class="csp-name">{option.label}</span>
            <!-- Only when it ADDS information: `Staff → Staff` is noise. -->
            {#if option.source && option.source !== option.label}
              <span class="t-caption csp-src">{option.source}</span>
            {/if}
          </div>
        {/snippet}
        {#snippet content()}
          <ul class="csp-preview">
            {#each preview.shown as item, i (item.name + i)}
              <li>
                <span class="csp-dot" style:background={item.color}></span>
                <span class="truncate">{item.name}</span>
              </li>
            {/each}
            {#if preview.more > 0}
              <li class="csp-more">{m.cal_color_preview_more({ count: preview.more })}</li>
            {/if}
          </ul>
        {/snippet}
      </Tooltip>
    {/each}
  </div>
</div>

<style>
  .csp {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .csp-label {
    color: var(--color-text-secondary);
  }
  .csp-list {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .csp-opt {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: var(--control-height-sm);
    padding: 0 var(--space-2);
    cursor: pointer;
    color: var(--color-text-primary);
  }
  .csp-opt:hover {
    background: var(--color-surface-2);
  }
  /* List-selection contract: accent-TINTED surface + accent text, never a full
     accent fill (that is an action style). */
  .csp-opt.is-on {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    color: var(--color-accent);
  }
  .csp-src {
    color: var(--color-text-tertiary);
    white-space: nowrap;
  }
  .csp-preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    min-width: 8rem;
  }
  .csp-preview li {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .csp-dot {
    width: 8px;
    height: 8px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
  }
  .csp-more {
    color: var(--color-text-tertiary);
  }
</style>
