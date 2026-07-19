<script lang="ts">
  // Standard dashboard date controls: inclusive from/to, a customizable quick-range
  // picker (the ⋯ menu shows/hides which ranges appear as pills + sets the default),
  // and a SMART period picker that disables granularities too coarse for the span.
  // Controlled — the page owns the URL/state and reacts to onChange. See
  // UI-governance "dashboard date controls" contract.
  import { onMount } from 'svelte';
  import { MoreHorizontal, Check, Star } from 'lucide-svelte';
  import { iconSizes } from '$lib/components/ui';
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
    /** 'YYYY-MM-DD' or '' for an open bound. */
    from: string;
    to: string;
    period: Period;
    periods?: Period[];
    /** Real data span — lets "All time" show real dates. */
    dataMin?: string;
    dataMax?: string;
    /** Persist per-user quick-range visibility + default under this key. */
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
    dataMax,
    storageKey,
    class: cls = '',
    onChange,
  }: Props = $props();

  // Every selectable range, in display order. The menu shows ALL of these; the
  // pills show only the `visible` subset. Labels are shorthand.
  const ALL_RANGES = ['1d', '7d', '30d', 'ytd', '1y', 'mtd', '2mo', '3mo', '6mo', 'all'];
  const DEFAULT_VISIBLE = ['1d', '7d', '30d', 'ytd', '1y'];
  const label: Record<string, () => string> = {
    '1d': m.dr_q_1d,
    '7d': m.dr_q_7d,
    '30d': m.dr_q_30d,
    ytd: m.dr_q_ytd,
    '1y': m.dr_q_1y,
    mtd: m.dr_q_mtd,
    '2mo': m.dr_q_2mo,
    '3mo': m.dr_q_3mo,
    '6mo': m.dr_q_6mo,
    all: m.dr_q_all,
  };
  const periodLabel: Record<Period, () => string> = {
    day: m.dr_p_day,
    week: m.dr_p_week,
    month: m.dr_p_month,
    year: m.dr_p_year,
  };

  const now = () => new Date();

  let visibleIds = $state<string[]>(DEFAULT_VISIBLE);
  let defaultId = $state<string | null>(null);

  const quickItems = $derived<SegmentItem[]>(
    visibleIds.map((id) => ({ value: id, label: label[id]() })),
  );
  const activeQuick = $derived(
    matchQuickRange(from, to, ALL_RANGES, now(), dataMin, dataMax) ?? '',
  );

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
    const r = quickRange(id, now(), dataMin, dataMax);
    if (r) apply(r.from, r.to);
  }
  const onFrom = (e: Event) => apply((e.currentTarget as HTMLInputElement).value, to);
  const onTo = (e: Event) => apply(from, (e.currentTarget as HTMLInputElement).value);
  const onPeriod = (p: string) => onChange({ from, to, period: p as Period });

  // ── Show/hide + default config menu (⋯ button or right-click) ─────────────────
  let menuOpen = $state(false);
  function persistCfg() {
    if (!storageKey) return;
    try {
      localStorage.setItem(
        `dash-range-cfg:${storageKey}`,
        JSON.stringify({ visible: visibleIds, default: defaultId }),
      );
    } catch {
      /* ignore */
    }
  }
  function toggleVisible(id: string) {
    if (visibleIds.includes(id)) {
      if (visibleIds.length <= 1) return; // keep at least one pill
      visibleIds = visibleIds.filter((x) => x !== id);
      if (defaultId === id) defaultId = null; // a hidden range can't be the default
    } else {
      visibleIds = ALL_RANGES.filter((x) => visibleIds.includes(x) || x === id);
    }
    persistCfg();
  }
  function setDefault(id: string) {
    defaultId = defaultId === id ? null : id;
    if (defaultId && !visibleIds.includes(id)) {
      visibleIds = ALL_RANGES.filter((x) => visibleIds.includes(x) || x === id);
    }
    persistCfg();
  }

  onMount(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(`dash-range-cfg:${storageKey}`);
      if (raw) {
        const cfg = JSON.parse(raw) as { visible?: string[]; default?: string | null };
        if (Array.isArray(cfg.visible) && cfg.visible.length) {
          visibleIds = ALL_RANGES.filter((x) => cfg.visible!.includes(x));
        }
        defaultId = typeof cfg.default === 'string' ? cfg.default : null;
      }
    } catch {
      /* ignore */
    }
    // Apply the stored default range once, if it differs from the current window.
    if (defaultId) {
      const r = quickRange(defaultId, now(), dataMin, dataMax);
      if (r && (r.from !== from || r.to !== to)) apply(r.from, r.to);
    }
  });
</script>

<svelte:document
  onpointerdown={(e) => {
    if (menuOpen && !(e.target as HTMLElement).closest('.dr-quick')) menuOpen = false;
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

  <div class="dr-quick">
    <SegmentedControl
      items={quickItems}
      value={activeQuick}
      aria-label={m.dr_quick_label()}
      onValueChange={applyQuick}
      oncontextmenu={(e) => {
        e.preventDefault();
        menuOpen = true;
      }}
    >
      {#snippet trailing()}
        <button
          type="button"
          class="dr-cfg-btn"
          class:open={menuOpen}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label={m.dr_cfg_ranges()}
          title={m.dr_cfg_ranges()}
          onclick={() => (menuOpen = !menuOpen)}
        >
          <MoreHorizontal size={iconSizes.sm} />
        </button>
      {/snippet}
    </SegmentedControl>

    {#if menuOpen}
      <div class="dr-menu" role="menu">
        {#each ALL_RANGES as id (id)}
          {@const shown = visibleIds.includes(id)}
          <div class="dr-row">
            <button
              type="button"
              class="dr-row-toggle"
              class:shown
              role="menuitemcheckbox"
              aria-checked={shown}
              title={m.dr_toggle_visible()}
              onclick={() => toggleVisible(id)}
            >
              <span class="dr-check">{#if shown}<Check size={iconSizes.xs} strokeWidth={3} />{/if}</span>
              <span class="dr-label">{label[id]()}</span>
            </button>
            <button
              type="button"
              class="dr-star"
              class:on={defaultId === id}
              aria-pressed={defaultId === id}
              title={m.dr_set_default()}
              onclick={() => setDefault(id)}
            >
              <Star size={iconSizes.xs} />
            </button>
          </div>
        {/each}
      </div>
    {/if}
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
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  /* ⋯ trailing button — sits inside the segmented group, styled like a control
     but never a selectable option. */
  .dr-cfg-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-secondary);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-standard);
  }
  .dr-cfg-btn:hover,
  .dr-cfg-btn.open {
    color: var(--color-text-primary);
  }
  .dr-cfg-btn:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }
  .dr-menu {
    position: absolute;
    top: calc(100% + var(--space-1));
    right: 0;
    z-index: var(--layer-popover);
    min-width: 12rem;
    padding: var(--space-1);
    border: 1px solid var(--color-border, var(--hairline));
    border-radius: var(--radius-md);
    background: var(--color-overlay);
    box-shadow: var(--shadow-overlay);
  }
  .dr-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .dr-row-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
    padding: var(--space-2) var(--space-2);
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    color: var(--color-text-secondary);
    font-size: var(--font-size-body);
    text-align: left;
    cursor: pointer;
  }
  .dr-row-toggle.shown {
    color: var(--color-text-primary);
  }
  .dr-row-toggle:hover {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  .dr-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 0.9rem;
    height: 0.9rem;
    color: var(--color-accent);
  }
  .dr-label {
    font-variant-numeric: tabular-nums;
  }
  .dr-star {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--control-height-xs);
    height: var(--control-height-xs);
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    color: var(--color-text-disabled);
    cursor: pointer;
    transition: color var(--duration-fast) var(--ease-standard);
  }
  .dr-star:hover {
    color: var(--color-text-secondary);
  }
  .dr-star.on {
    color: var(--color-accent);
  }
  .dr-star.on :global(svg) {
    fill: var(--color-accent);
  }
</style>
