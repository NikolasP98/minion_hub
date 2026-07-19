<script lang="ts">
  // Standard dashboard date controls: from/to (inclusive), quick ranges with an
  // extended-range menu, and a SMART period picker that disables granularities
  // too coarse for the selected span. Controlled — the page owns the URL/state and
  // reacts to onChange. See UI-governance "dashboard date controls" contract.
  import { onMount } from 'svelte';
  import { MoreHorizontal, Check } from 'lucide-svelte';
  import SegmentedControl, { type SegmentItem } from '$lib/components/ui/SegmentedControl.svelte';
  import * as m from '$lib/paraglide/messages';
  import {
    type Period,
    ALL_PERIODS,
    periodEnabled,
    coercePeriod,
    quickRange,
    matchQuickRange,
  } from './date-range';

  interface Props {
    /** 'YYYY-MM-DD' or '' for an open (all-time) bound. */
    from: string;
    to: string;
    period: Period;
    /** Which period granularities to offer (a dashboard may not support all). */
    periods?: Period[];
    /** Earliest real record — lets "All time" clamp to the data start. */
    dataMin?: string;
    /** Persist a per-user default quick-range under this key (localStorage). */
    storageKey?: string;
    class?: string;
    onChange: (v: { from: string; to: string; period: Period }) => void;
  }

  let {
    from,
    to,
    period,
    periods = ALL_PERIODS,
    dataMin,
    storageKey,
    class: cls = '',
    onChange,
  }: Props = $props();

  const QUICK = ['1d', '7d', '30d', 'ytd', '1y'];
  const MORE = ['mtd', '2mo', '3mo', '6mo', 'all'];
  const quickLabel: Record<string, () => string> = {
    '1d': m.dr_q_1d,
    '7d': m.dr_q_7d,
    '30d': m.dr_q_30d,
    ytd: m.dr_q_ytd,
    '1y': m.dr_q_1y,
  };
  const moreLabel: Record<string, () => string> = {
    mtd: m.dr_r_mtd,
    '2mo': m.dr_r_2mo,
    '3mo': m.dr_r_3mo,
    '6mo': m.dr_r_6mo,
    all: m.dr_r_all,
  };
  const periodLabel: Record<Period, () => string> = {
    day: m.dr_p_day,
    week: m.dr_p_week,
    month: m.dr_p_month,
    year: m.dr_p_year,
  };

  const now = () => new Date();

  const quickItems = $derived<SegmentItem[]>(
    QUICK.map((id) => ({ value: id, label: quickLabel[id]() })),
  );
  const activeQuick = $derived(matchQuickRange(from, to, QUICK, now(), dataMin) ?? '');

  const periodItems = $derived<SegmentItem[]>(
    periods.map((p) => {
      const enabled = periodEnabled(p, from, to);
      return {
        value: p,
        label: periodLabel[p](),
        disabled: !enabled,
        title: enabled ? undefined : m.dr_period_disabled(),
      };
    }),
  );

  function apply(f: string, t: string, keepPeriod: Period = period) {
    onChange({ from: f, to: t, period: coercePeriod(keepPeriod, f, t, periods) });
  }
  function applyQuick(id: string) {
    const r = quickRange(id, now(), dataMin);
    if (r) apply(r.from, r.to);
  }
  const onFrom = (e: Event) => apply((e.currentTarget as HTMLInputElement).value, to);
  const onTo = (e: Event) => apply(from, (e.currentTarget as HTMLInputElement).value);
  const onPeriod = (p: string) => onChange({ from, to, period: p as Period });

  // ── Extended-range menu (⋯ button or right-click on the quick group) ──────────
  let menuOpen = $state(false);
  function pickMore(id: string) {
    menuOpen = false;
    applyQuick(id); // 'all' resolves to open ('') bounds via quickRange
  }
  function setDefault() {
    menuOpen = false;
    if (storageKey && activeQuick) {
      try {
        localStorage.setItem(`dash-range-default:${storageKey}`, activeQuick);
      } catch {
        /* ignore */
      }
    }
  }

  // Apply a stored default quick-range once on mount (client-only personalization).
  onMount(() => {
    if (!storageKey) return;
    let id: string | null = null;
    try {
      id = localStorage.getItem(`dash-range-default:${storageKey}`);
    } catch {
      /* ignore */
    }
    if (!id) return;
    const r = quickRange(id, now(), dataMin);
    if (r && (r.from !== from || r.to !== to)) apply(r.from, r.to);
  });
</script>

<svelte:document
  onpointerdown={(e) => {
    if (menuOpen && !(e.target as HTMLElement).closest('.dr-more')) menuOpen = false;
  }}
  onkeydown={(e) => {
    if (menuOpen && e.key === 'Escape') menuOpen = false;
  }}
/>

<div class="dr {cls}">
  <div class="dr-dates">
    <label class="dr-field">
      <span>{m.dr_from()}</span>
      <input type="date" value={from} max={to || undefined} oninput={onFrom} />
    </label>
    <label class="dr-field">
      <span>{m.dr_to()}</span>
      <input type="date" value={to} min={from || undefined} oninput={onTo} />
    </label>
  </div>

  <div class="dr-quick" oncontextmenu={(e) => { e.preventDefault(); menuOpen = true; }}>
    <SegmentedControl
      items={quickItems}
      value={activeQuick}
      aria-label={m.dr_quick_label()}
      onValueChange={applyQuick}
    />
    <div class="dr-more">
      <button
        type="button"
        class="dr-more-btn"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={m.dr_more()}
        title={m.dr_more()}
        onclick={() => (menuOpen = !menuOpen)}
      >
        <MoreHorizontal size={16} />
      </button>
      {#if menuOpen}
        <div class="dr-menu" role="menu">
          {#each MORE as id (id)}
            <button type="button" class="dr-menu-item" role="menuitem" onclick={() => pickMore(id)}
              >{moreLabel[id]()}</button
            >
          {/each}
          {#if storageKey}
            <div class="dr-menu-sep"></div>
            <button
              type="button"
              class="dr-menu-item"
              role="menuitem"
              disabled={!activeQuick}
              onclick={setDefault}
            >
              <Check size={13} />
              {m.dr_set_default()}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  {#if periods.length > 1}
    <SegmentedControl
      items={periodItems}
      value={period}
      aria-label={m.dr_period_label()}
      onValueChange={onPeriod}
    />
  {/if}
</div>

<style>
  .dr {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .dr-dates {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .dr-field {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }
  .dr-field input {
    height: var(--control-height-sm);
    padding: 0 var(--space-2);
    border: 1px solid var(--color-border, var(--hairline));
    border-radius: var(--radius-sm);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
  }
  .dr-field input:focus-visible {
    outline: none;
    border-color: var(--color-accent);
  }
  .dr-quick {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }
  .dr-more {
    position: relative;
  }
  .dr-more-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-height-sm);
    height: var(--control-height-sm);
    border: 1px solid var(--color-border, var(--hairline));
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-standard);
  }
  .dr-more-btn:hover {
    color: var(--color-text-primary);
  }
  .dr-more-btn:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }
  .dr-menu {
    position: absolute;
    top: calc(100% + var(--space-1));
    right: 0;
    z-index: var(--layer-popover);
    min-width: 11rem;
    padding: var(--space-1);
    border: 1px solid var(--color-border, var(--hairline));
    border-radius: var(--radius-md);
    background: var(--color-overlay);
    box-shadow: var(--shadow-overlay);
  }
  .dr-menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
    text-align: left;
    cursor: pointer;
  }
  .dr-menu-item:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    color: var(--color-accent);
  }
  .dr-menu-item:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .dr-menu-sep {
    height: 1px;
    margin: var(--space-1) 0;
    background: var(--color-border, var(--hairline));
  }
</style>
