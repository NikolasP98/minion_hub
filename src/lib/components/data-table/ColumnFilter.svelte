<script lang="ts">
  import { Button, iconSizes } from '$lib/components/ui';
  import { ChevronDown } from 'lucide-svelte';
  import type { Snippet } from 'svelte';
  import { emptyFilter, isFilterActive, type FilterKind, type FilterValue } from './filters';
  import FilterRuleEditor from './FilterRuleEditor.svelte';

  type Option = { value: string; label: string };
  let {
    label,
    options = [],
    selected = $bindable(new Set<string>()),
    align = 'left',
    optionIcon,
    onSelect,
    kind = 'enum',
    value = null,
    onValue,
  }: {
    label: string;
    /** Enum kind only: the option list. */
    options?: Option[];
    /** Enum kind only. Empty set = "All". Non-empty = only those values. */
    selected?: Set<string>;
    align?: 'left' | 'right';
    optionIcon?: Snippet<[string]>;
    /** Fires with the new set when the selection changes. Use instead of
     *  `bind:selected` when the set isn't a bindable variable (e.g. derived). */
    onSelect?: (s: Set<string>) => void;
    /** `enum` (default) = multi-select. `text` = contains. `number`/`date` = an
     *  inclusive min/max range. */
    kind?: FilterKind;
    /** Current value for a non-enum kind. */
    value?: FilterValue | null;
    /** Fires with the new value for a non-enum kind. */
    onValue?: (v: FilterValue) => void;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);

  // The header popover and the chip (FilterChip, wired in Stage 2) edit the
  // SAME rule: when no full `value` is threaded yet, fall back to `selected`
  // so a plain enum caller (bind:selected/onSelect only) keeps working.
  const effectiveValue = $derived<FilterValue>(
    value ?? (kind === 'enum' ? { kind: 'enum', values: [...selected] } : emptyFilter(kind)),
  );
  const active = $derived(isFilterActive(effectiveValue));
  const badgeCount = $derived(kind === 'enum' ? selected.size : null);

  /** Rehosted on FilterRuleEditor: keeps the legacy `selected`/`onSelect`
   *  contract alive for the enum kind while also forwarding the full value
   *  (so a non-default operator survives — `onSelect` alone would drop it). */
  function handleValue(next: FilterValue) {
    if (next.kind === 'enum') {
      const nextSet = new Set(next.values);
      selected = nextSet;
      onSelect?.(nextSet);
    }
    onValue?.(next);
  }

  // Outside-click dismissal via a document listener. The previous fixed-inset
  // backdrop element could not work here: this component lives inside the
  // table's sticky <thead>, whose backdrop-filter makes it the containing
  // block for position:fixed descendants — the "viewport" backdrop only ever
  // covered the header strip.
  function onDocPointerDown(e: PointerEvent) {
    if (open && root && !root.contains(e.target as Node)) open = false;
  }
  function onDocKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') open = false;
  }
</script>

<svelte:document onpointerdown={onDocPointerDown} onkeydown={onDocKeydown} />

<div class="cf" bind:this={root}>
  <Button
    variant="ghost"
    size="xs"
    class="head {active ? 'active' : ''}"
    aria-haspopup="listbox"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span>{label}</span>
    {#if active}<span class="badge" class:dot={badgeCount == null}>{badgeCount ?? ''}</span>{/if}
    <ChevronDown size={iconSizes.xs} class="chev {open ? 'flip' : ''}" />
  </Button>

  {#if open}
    <div class="pop" class:right={align === 'right'}>
      <FilterRuleEditor
        {kind}
        {options}
        value={effectiveValue}
        onValue={handleValue}
        {optionIcon}
      />
    </div>
  {/if}
</div>

<style>
  .cf {
    position: relative;
    display: inline-flex;
    min-width: 0;
  }
  /* Header-first trigger: inherits the th's .t-label typography; the only
     affordance is the chevron. Strips the Button primitive's control chrome
     so the header row height never inflates. */
  .cf :global(.head) {
    height: auto;
    padding: 0;
    border: none;
    background: transparent;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .cf :global(.head > span) {
    gap: var(--space-1);
  }
  .cf :global(.head:hover) {
    background: transparent;
    color: var(--color-foreground);
  }
  .cf :global(.head.active) {
    color: var(--color-accent);
  }
  .badge {
    font-size: var(--font-size-telemetry);
    min-width: 1rem;
    height: 1rem;
    padding: 0 0.2rem;
    border-radius: var(--radius-full);
    background: var(--color-accent);
    color: var(--color-on-accent);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  :global(.cf .chev) {
    transition: transform var(--duration-fast);
    opacity: 0.6;
  }
  :global(.cf .chev.flip) {
    transform: rotate(180deg);
  }
  .pop {
    position: absolute;
    top: calc(100% + var(--space-1));
    left: 0;
    z-index: var(--layer-dropdown);
    min-width: 11rem;
    max-height: 16rem;
    overflow: auto;
    background: var(--color-overlay);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-1);
  }
  .pop.right {
    left: auto;
    right: 0;
  }
  .badge.dot {
    min-width: 0.5rem;
    width: 0.5rem;
    height: 0.5rem;
    padding: 0;
  }
</style>
