<script lang="ts">
  // Standard dashboard date controls: inclusive from/to, a customizable quick-range
  // picker (the ⋯ menu shows/hides which ranges appear as pills + sets the default),
  // and a SMART period picker that disables granularities too coarse for the span.
  //
  // Controlled — the page owns the URL/state and reacts to onChange. All logic
  // lives in the ./date-range SDK; this file is presentation + wiring only.
  // See UI-governance "dashboard date controls" contract.
  import { onMount } from 'svelte';
  import * as menu from '@zag-js/menu';
  import { useMachine, normalizeProps } from '@zag-js/svelte';
  import { MoreHorizontal, Check, Star } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import SegmentedControl, { type SegmentItem } from '$lib/components/ui/SegmentedControl.svelte';
  import * as m from '$lib/paraglide/messages';
  import {
    type Period,
    type RangeId,
    type RangeConfig,
    ALL_PERIODS,
    ALL_RANGE_IDS,
    DATE_RANGE_IDS,
    DEFAULT_VISIBLE_RANGES,
    rangeDef,
    resolveRange,
    matchRange,
    periodEnabled,
    coercePeriod,
    defaultRangeConfig,
    loadRangeConfig,
    saveRangeConfig,
    toggleRangeVisible,
    setDefaultRange,
  } from './date-range';

  interface Props {
    /** 'YYYY-MM-DD' or '' for an open bound. */
    from: string;
    to: string;
    /** Granularity. Pass `periods={[]}` on dashboards that don't bucket. */
    period?: Period;
    periods?: Period[];
    /**
     * Opt into time-of-day: datetime bounds + the sub-day ranges (1h/6h/24h).
     * Telemetry surfaces only — every other dashboard stays date-granular.
     */
    withTime?: boolean;
    /** Which quick ranges this dashboard offers at all. */
    ranges?: RangeId[];
    /** Which of those start out as pills (the rest live in the ⋯ menu). */
    defaultVisible?: RangeId[];
    /** Real data span — lets "All time" show real dates. */
    dataMin?: string;
    dataMax?: string;
    /** Explicit date-policy timezone (organization business or viewer). */
    timeZone: string;
    /** Persist per-user pill visibility + default under this key. */
    storageKey?: string;
    class?: string;
    onChange: (v: { from: string; to: string; period: Period }) => void;
  }

  let {
    from,
    to,
    period = 'day',
    periods = ALL_PERIODS,
    withTime = false,
    // Sub-day ranges stay hidden unless the surface opted into time-of-day.
    ranges = withTime ? ALL_RANGE_IDS : DATE_RANGE_IDS,
    defaultVisible = DEFAULT_VISIBLE_RANGES,
    dataMin,
    dataMax,
    timeZone,
    storageKey,
    class: cls = '',
    onChange,
  }: Props = $props();

  let activeNow = $state(new Date());
  const ctx = $derived({ now: activeNow, timeZone, dataMin, dataMax });
  const freshContext = (now = new Date()) => ({ now, timeZone, dataMin, dataMax });
  const seedVisible = $derived(defaultVisible.filter((id) => ranges.includes(id)));

  let cfg = $state<RangeConfig>(
    defaultRangeConfig(DEFAULT_VISIBLE_RANGES.filter((id) => ranges.includes(id))),
  );

  const visibleIds = $derived(cfg.visible.filter((id) => ranges.includes(id)));
  const quickItems = $derived<SegmentItem[]>(
    visibleIds.map((id) => ({ value: id, label: rangeDef(id)?.label() ?? id })),
  );
  const activeQuick = $derived(matchRange({ from, to }, ranges, ctx) ?? '');

  const periodLabel: Record<Period, () => string> = {
    hour: m.dr_p_hour,
    day: m.dr_p_day,
    week: m.dr_p_week,
    month: m.dr_p_month,
    year: m.dr_p_year,
  };

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
    const allowed = periods.length ? periods : ALL_PERIODS;
    onChange({ from: f, to: t, period: coercePeriod(keepPeriod, f, t, allowed) });
  }
  function applyRange(id: RangeId) {
    const now = new Date();
    activeNow = now;
    const r = resolveRange(id, freshContext(now));
    if (r) apply(r.from, r.to);
  }
  const onFrom = (e: Event) => apply((e.currentTarget as HTMLInputElement).value, to);
  const onTo = (e: Event) => apply(from, (e.currentTarget as HTMLInputElement).value);
  const onPeriod = (p: string) => onChange({ from, to, period: p as Period });

  // ── Show/hide + default config menu (⋯ button or right-click) ─────────────────
  // The Zag menu machine (the engine under the `Dropdown` primitive) rather than a
  // hand-rolled panel: it owns the composite keyboard model (arrows/Home/End/
  // typeahead over `aria-activedescendant`, Escape + outside-click dismissal with
  // focus return) and the menuitemcheckbox/menuitemradio rows that `Dropdown`'s
  // one-action-per-row items cannot express (HC-029). Not portaled: the panel is
  // anchored inside `.dr-quick` like before, so no sticky/overflow host to escape.
  const menuId = $props.id();
  const menuService = useMachine(menu.machine, () => ({
    id: menuId,
    closeOnSelect: false, // toggling several ranges in one visit is the point
    positioning: { placement: 'bottom-end' as const },
  }));
  const menuApi = $derived(menu.connect(menuService, normalizeProps));
  const menuContent = $derived(menuApi.getContentProps());
  // Zag types element props as Svelte's nullable HTML attributes; <Button>'s own props
  // are strict (`disabled?: boolean`), so the spread travels through its index signature.
  const buttonProps = (p: object) => p as Record<string, unknown>;
  // Tab leaves the menu (WAI-ARIA menu button): close it so focus returns to the
  // trigger and the browser's own sequential navigation moves on from there —
  // Zag's content handler would otherwise swallow the key and trap focus.
  function onMenuKeydown(e: KeyboardEvent & { currentTarget: EventTarget & HTMLElement }) {
    if (e.key === 'Tab') {
      menuApi.setOpen(false);
      return;
    }
    menuContent.onkeydown?.(e);
  }
  const persist = () => storageKey && saveRangeConfig(storageKey, cfg);
  function onToggleVisible(id: RangeId) {
    cfg = toggleRangeVisible(cfg, id);
    persist();
  }
  function onSetDefault(id: RangeId) {
    cfg = setDefaultRange(cfg, id);
    persist();
  }

  onMount(() => {
    if (storageKey) cfg = loadRangeConfig(storageKey, seedVisible);
    // Apply the stored default window once, if it differs from the current one.
    if (cfg.default) {
      const now = new Date();
      activeNow = now;
      const r = resolveRange(cfg.default, freshContext(now));
      if (r && (r.from !== from || r.to !== to)) apply(r.from, r.to);
    }
    const id = setInterval(() => (activeNow = new Date()), 60_000);
    return () => clearInterval(id);
  });
</script>

<div class="dr {cls}">
  <div class="dr-dates">
    <label class="dr-field">
      <span>{m.dr_from()}</span>
      <input
        type={withTime ? 'datetime-local' : 'date'}
        value={from}
        max={to || undefined}
        oninput={onFrom}
      />
    </label>
    <label class="dr-field">
      <span>{m.dr_to()}</span>
      <input
        type={withTime ? 'datetime-local' : 'date'}
        value={to}
        min={from || undefined}
        oninput={onTo}
      />
    </label>
  </div>

  <div class="dr-quick">
    <SegmentedControl
      items={quickItems}
      value={activeQuick}
      aria-label={m.dr_quick_label()}
      onValueChange={applyRange}
      oncontextmenu={(e) => {
        // Right-click or the keyboard ContextMenu key (Shift+F10) anywhere on the
        // group opens the same menu, anchored to ⋯ so Escape returns focus there.
        e.preventDefault();
        menuApi.setOpen(true);
      }}
    >
      {#snippet trailing()}
        <Button
          {...buttonProps(menuApi.getTriggerProps())}
          type="button"
          variant="ghost"
          size="xs"
          shape="icon"
          class={`dr-cfg-btn${menuApi.open ? ' open' : ''}`}
          aria-label={m.dr_cfg_ranges()}
          title={m.dr_cfg_ranges()}
        >
          <MoreHorizontal size={iconSizes.sm} />
        </Button>
      {/snippet}
    </SegmentedControl>

    <!-- Always mounted, hidden by Zag's `hidden` (same as Dropdown). The content
         carries the layer; Zag copies it onto the positioner on every reposition. -->
    <div {...menuApi.getPositionerProps()}>
      <div {...menuContent} class="dr-menu" onkeydown={onMenuKeydown}>
        {#each ranges as id (id)}
          {@const shown = visibleIds.includes(id)}
          {@const label = rangeDef(id)?.label() ?? id}
          <div class="dr-row">
            <Button
              {...buttonProps(
                menuApi.getOptionItemProps({
                  type: 'checkbox',
                  value: id,
                  valueText: label,
                  checked: shown,
                  onCheckedChange: () => onToggleVisible(id),
                }),
              )}
              tabindex={-1}
              type="button"
              variant="ghost"
              size="sm"
              class={`dr-row-toggle${shown ? ' shown' : ''}`}
              title={m.dr_toggle_visible()}
            >
              <span class="dr-check"
                >{#if shown}<Check size={iconSizes.xs} strokeWidth={3} />{/if}</span
              >
              <span class="dr-label">{label}</span>
            </Button>
            <Button
              {...buttonProps(
                menuApi.getOptionItemProps({
                  type: 'radio',
                  value: `default:${id}`,
                  valueText: label,
                  checked: cfg.default === id,
                  // Re-picking the current default clears it (setDefaultRange).
                  onCheckedChange: () => onSetDefault(id),
                }),
              )}
              tabindex={-1}
              type="button"
              variant="ghost"
              size="xs"
              shape="icon"
              class={`dr-star${cfg.default === id ? ' on' : ''}`}
              aria-label={`${m.dr_set_default()} · ${label}`}
              title={m.dr_set_default()}
            >
              <Star size={iconSizes.xs} />
            </Button>
          </div>
        {/each}
      </div>
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
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  /* ⋯ trailing button — sits inside the segmented group, styled like a control
     but never a selectable option. Forwarded to <Button>, so anchored through the
     scoped `.dr-quick` ancestor (a bare `.dr-cfg-btn` never matched — see
     UI-governance "real ancestor anchor"). */
  .dr-quick :global(.dr-cfg-btn) {
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
  .dr-quick :global(.dr-cfg-btn:hover),
  .dr-quick :global(.dr-cfg-btn.open) {
    color: var(--color-text-primary);
  }
  .dr-quick :global(.dr-cfg-btn:focus-visible) {
    outline: none;
    box-shadow: var(--shadow-focus);
  }
  .dr-menu {
    /* Positioned so the layer token resolves (Zag reads the content's computed
       z-index); the positioner's own placement comes from the machine. */
    position: relative;
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
  .dr-row :global(.dr-row-toggle) {
    display: flex;
    align-items: center;
    justify-content: flex-start;
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
  .dr-row :global(.dr-row-toggle.shown) {
    color: var(--color-text-primary);
  }
  /* Keyboard highlight (aria-activedescendant) reads exactly like pointer hover. */
  .dr-row :global(.dr-row-toggle:hover),
  .dr-row :global(.dr-row-toggle[data-highlighted]) {
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
  .dr-row :global(.dr-star) {
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
  .dr-row :global(.dr-star:hover),
  .dr-row :global(.dr-star[data-highlighted]) {
    color: var(--color-text-secondary);
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
  }
  .dr-row :global(.dr-star.on) {
    color: var(--color-accent);
  }
  .dr-row :global(.dr-star.on svg) {
    fill: var(--color-accent);
  }
  /* Coarse-pointer / narrow floor on every target (toolbar rule, addressed by
     role so the SegmentedControl pills are covered through their scoped ancestor). */
  @media (max-width: 767.98px), (pointer: coarse) {
    .dr-field input,
    .dr :global(.seg-btn),
    .dr-quick :global(.dr-cfg-btn),
    .dr-row :global(.dr-row-toggle),
    .dr-row :global(.dr-star) {
      min-height: var(--control-height-touch);
    }
    .dr :global(.seg-btn),
    .dr-quick :global(.dr-cfg-btn),
    .dr-row :global(.dr-star) {
      min-width: var(--control-height-touch);
    }
    .dr :global(.seg) {
      height: auto; /* the group grows with its 44px pills instead of clipping them */
    }
  }
</style>
