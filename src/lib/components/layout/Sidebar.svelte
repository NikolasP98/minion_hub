<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { invalidate } from '$app/navigation';
  import {
    Activity,
    Store,
    SquareTerminal,
    Settings,
    PanelLeftClose,
    PanelLeft,
    ChevronDown,
    ChevronRight,
    Star,
    Check,
  } from 'lucide-svelte';
  import NavIcon from './NavIcon.svelte';
  import { Tooltip } from '$lib/components/ui';
  import { getSections, getDynamicPluginsSections, type Section, type SectionItem } from './sections';
  import MinionLogo from './MinionLogo.svelte';
  import OrgPicker from './OrgPicker.svelte';
  import { pluginNavState } from '$lib/state/plugin-nav.svelte';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { canClient } from '$lib/access/can.svelte';
  import * as m from '$lib/paraglide/messages';
  import FinanceSyncBadge from '$lib/components/finance/FinanceSyncBadge.svelte';
  import { financeSync } from '$lib/state/features/finance-sync.svelte';

  // Full version of the connected server (e.g. 2026.6.14-dev), shown beside the
  // brand. Relocated from the agents-sidebar footer.
  const serverVersion = $derived(gw.hello?.server?.version ?? null);

  const staticSections = $derived(getSections());
  // Pass per-org enabled map so the derive re-runs when a plugin is toggled —
  // disabled-for-org plugin items render dimmed, reactively, with no reload.
  const pluginsSections = $derived(
    getDynamicPluginsSections(pluginNavState.controlCenters, pluginNavState.enabledByPluginId),
  );
  const navSections = $derived<Section[]>([...staticSections, ...pluginsSections]);

  const showReliability = $derived(canClient('reliability.monitor'));
  const showTerminal = $derived(canClient('terminal.shell'));
  const isSettings = $derived(page.url.pathname.startsWith('/settings'));

  // Top utility row: icon-only pills that expand inline to icon+label when the
  // user is on that page. Reliability is gated by the monitor policy.
  type TopItem = { href: string; label: string; icon: typeof Activity; show: boolean };
  const topItems = $derived<TopItem[]>(
    [
      { href: '/reliability', label: m.nav_reliability(), icon: Activity, show: showReliability },
      { href: '/marketplace', label: m.nav_marketplace(), icon: Store, show: canClient('marketplace.view') },
      { href: '/terminal', label: m.nav_terminal(), icon: SquareTerminal, show: showTerminal },
    ].filter((t) => t.show),
  );

  // The user's chosen landing page (right-click → Set as home). Falls back to
  // /home. Stored per-user in Supabase prefs (section "landingPage").
  const currentHome = $derived(
    ((page.data as { preferences?: Record<string, unknown> })?.preferences?.landingPage as
      | string
      | undefined) ?? '/home',
  );

  // Two responsive tiers:
  //   <md  : sidebar hidden — the mobile hamburger (Topbar) takes over.
  //   md+  : honors the user's collapse preference (expanded 224px / mini 56px).
  let collapsed = $state(false);
  let isMd = $state(true);
  onMount(() => {
    financeSync.refresh('susii');
    collapsed = localStorage.getItem('hub-sidebar-collapsed') === '1';
    const mq = window.matchMedia('(min-width: 48rem)');
    const sync = () => (isMd = mq.matches);
    sync();
    mq.addEventListener('change', sync);
    const onWin = () => (ctxMenu = null);
    window.addEventListener('click', onWin);
    window.addEventListener('keydown', onKey);
    return () => {
      mq.removeEventListener('change', sync);
      window.removeEventListener('click', onWin);
      window.removeEventListener('keydown', onKey);
    };
  });
  function toggle() {
    collapsed = !collapsed;
    localStorage.setItem('hub-sidebar-collapsed', collapsed ? '1' : '0');
  }

  // Labels hidden (so tooltips earn their keep) whenever not md+ expanded.
  const showTooltips = $derived(collapsed || !isMd);
  const widthCls = $derived(collapsed ? 'w-14' : 'w-14 md:w-[224px]');
  const labelCls = $derived(collapsed ? 'hidden' : 'hidden md:inline');
  const headCls = $derived(collapsed ? 'hidden' : 'hidden md:block');
  const rowJustify = $derived(collapsed ? 'justify-center' : 'justify-center md:justify-start');

  // Active-state resolver: archetype roster filters are query-aware.
  function isActive(item: SectionItem): boolean {
    return item.activeWhen ? item.activeWhen(page.url) : item.matcher(page.url.pathname);
  }

  // Collapsible subsection state (Customer Support → Channels). Default open.
  let collapsedSubs = $state<Record<string, boolean>>({});
  function toggleSub(id: string) {
    collapsedSubs = { ...collapsedSubs, [id]: !collapsedSubs[id] };
  }

  // ── Right-click "Set as home page" context menu ──────────────────────────
  let ctxMenu = $state<{ x: number; y: number; href: string; label: string } | null>(null);
  function openCtx(e: MouseEvent, href: string, label: string) {
    e.preventDefault();
    ctxMenu = { x: e.clientX, y: e.clientY, href, label };
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') ctxMenu = null;
  }
  async function setAsHome(href: string) {
    ctxMenu = null;
    try {
      await fetch('/api/me/preferences/landingPage', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: href }),
      });
      await invalidate('app:preferences');
    } catch {
      /* best-effort; non-blocking */
    }
  }
</script>

<aside
  class="surface-1 hidden md:flex flex-col shrink-0 {widthCls} h-full border-r border-[var(--hairline)] transition-[width] duration-200 ease-[cubic-bezier(0.2,0,0,1)] z-40"
  aria-label="Primary"
>
  <!-- Brand + active gateway (relocated from the topbar) -->
  <div class="shrink-0 px-2 pt-3 pb-2 flex flex-col gap-2">
    <a
      href="/"
      class="flex items-center {collapsed ? 'justify-center' : 'justify-center md:justify-start'} gap-2 h-9 px-1.5 rounded-[var(--radius-md)] hover:bg-white/[0.05] transition-colors duration-[150ms] group"
      aria-label="Minion Hub"
    >
      {#if collapsed}
        <MinionLogo size="sm" />
      {:else}
        <span class="hidden md:flex items-baseline leading-none">
          <span class="font-black text-sm tracking-wide uppercase text-brand-pink group-hover:text-brand-pink/90 transition-colors">MINION</span>
          <span class="font-semibold text-sm text-foreground/80 ml-1 group-hover:text-foreground transition-colors">hub</span>
          {#if serverVersion}
            <span class="ml-1.5 text-[10px] font-mono text-muted-foreground/70 whitespace-nowrap" title={serverVersion}>{serverVersion}</span>
          {/if}
        </span>
        <span class="md:hidden"><MinionLogo size="sm" /></span>
      {/if}
    </a>
    <div class={collapsed ? 'hidden' : 'hidden md:block'}>
      <OrgPicker />
    </div>
  </div>
  <div class="h-px bg-[var(--hairline)] mx-2 mb-1"></div>

  <!-- Top utility row: Reliability + Marketplace. Active item expands inline. -->
  {#if topItems.length}
    <div class="top-row {collapsed ? 'is-collapsed' : ''}">
      {#each topItems as t (t.href)}
        {@const active = page.url.pathname.startsWith(t.href)}
        {@const showLabel = !collapsed && isMd && active}
        <Tooltip label={t.label} id={`nav-tip-top-${t.href}`} placement="bottom" disabled={showLabel} openDelay={150} asChild>
          {#snippet children(trigger)}
            {@const Icon = t.icon}
            <a
              href={t.href}
              {...trigger}
              class="top-pill {active ? 'active' : ''} {showLabel ? 'grow' : ''}"
              aria-label={t.label}
              aria-current={active ? 'page' : undefined}
              oncontextmenu={(e) => openCtx(e, t.href, t.label)}
            >
              <Icon size={18} class="shrink-0" />
              <span class="top-label {showLabel ? 'show' : ''}">{t.label}</span>
            </a>
          {/snippet}
        </Tooltip>
      {/each}
    </div>
    <div class="h-px bg-[var(--hairline)] my-1.5 mx-2"></div>
  {/if}

  <nav class="sidebar-nav flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 py-1 flex flex-col gap-0.5">
    {#each navSections as section (section.id)}
      {@const items = section.items.filter((it) => !it.requires || canClient(it.requires))}
      {@const hasSubs = (section.subsections?.length ?? 0) > 0}
      {#if items.length || hasSubs}
        <div class="nav-group-head t-label {headCls}">{section.label}</div>
        {#each items as item (item.href)}
          {@const active = isActive(item)}
          <Tooltip label={item.label} id={`nav-tip-${item.href}`} placement="right" disabled={!showTooltips} openDelay={150} asChild>
            {#snippet children(trigger)}
              <a
                href={item.href}
                {...trigger}
                class="nav-row {rowJustify} {active
                  ? section.tone === 'brand'
                    ? 'nav-active brand'
                    : 'nav-active accent'
                  : ''}"
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                oncontextmenu={(e) => openCtx(e, item.href, item.label)}
              >
                <NavIcon icon={item.icon} size={18} class="nav-icon shrink-0" />
                <span class="nav-label {labelCls}">{item.label}</span>
                {#if item.href === '/finances'}
                  <FinanceSyncBadge />
                {/if}
                {#if currentHome === item.href}
                  <Star size={11} class="home-pin {labelCls}" />
                {/if}
              </a>
            {/snippet}
          </Tooltip>
        {/each}

        <!-- Collapsible subsections (Customer Support → Channels) -->
        {#each section.subsections ?? [] as sub (sub.id)}
          {@const subItems = sub.items.filter((it) => !it.requires || canClient(it.requires))}
          {#if subItems.length}
            {@const open = !collapsedSubs[sub.id]}
            {#if !collapsed}
              <button
                type="button"
                class="nav-subhead {rowJustify} {headCls}"
                onclick={() => toggleSub(sub.id)}
                aria-expanded={open}
              >
                {#if open}
                  <ChevronDown size={13} class="shrink-0 opacity-60" />
                {:else}
                  <ChevronRight size={13} class="shrink-0 opacity-60" />
                {/if}
                <span class="t-label">{sub.label}</span>
              </button>
            {/if}
            {#if open || collapsed}
              {#each subItems as item (item.href)}
                {@const active = isActive(item)}
                <Tooltip label={item.label} id={`nav-tip-${item.href}`} placement="right" disabled={!showTooltips} openDelay={150} asChild>
                  {#snippet children(trigger)}
                    <a
                      href={item.href}
                      {...trigger}
                      class="nav-row sub-item {rowJustify} {active ? 'nav-active accent' : ''}"
                      aria-label={item.label}
                      aria-current={active ? 'page' : undefined}
                      oncontextmenu={(e) => openCtx(e, item.href, item.label)}
                    >
                      <NavIcon icon={item.icon} size={18} class="nav-icon shrink-0" />
                      <span class="nav-label {labelCls}">{item.label}</span>
                      {#if currentHome === item.href}
                        <Star size={11} class="home-pin {labelCls}" />
                      {/if}
                    </a>
                  {/snippet}
                </Tooltip>
              {/each}
            {/if}
          {/if}
        {/each}

        <div class="h-px bg-[var(--hairline)] my-1.5 mx-1"></div>
      {/if}
    {/each}
  </nav>

  <!-- Pinned footer: Settings + collapse toggle -->
  <div class="shrink-0 px-2 py-2 border-t border-[var(--hairline)] flex flex-col gap-0.5">
    <Tooltip label={m.nav_settings()} id="nav-tip-settings" placement="right" disabled={!showTooltips} openDelay={150} asChild>
      {#snippet children(trigger)}
        <a
          href="/settings"
          {...trigger}
          class="nav-row {rowJustify} {isSettings ? 'nav-active accent' : ''}"
          aria-label={m.nav_settings()}
          oncontextmenu={(e) => openCtx(e, '/settings', m.nav_settings())}
        >
          <Settings size={18} class="nav-icon shrink-0" />
          <span class="nav-label {labelCls}">{m.nav_settings()}</span>
        </a>
      {/snippet}
    </Tooltip>
    <Tooltip
      label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      id="nav-tip-collapse"
      placement="right"
      disabled={!showTooltips}
      openDelay={150}
      asChild
    >
      {#snippet children(trigger)}
        <button
          type="button"
          {...trigger}
          onclick={toggle}
          class="nav-row collapse-toggle {rowJustify} text-muted-foreground"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {#if collapsed}
            <PanelLeft size={18} class="nav-icon shrink-0" />
          {:else}
            <PanelLeftClose size={18} class="nav-icon shrink-0" />
          {/if}
          <span class="nav-label {labelCls}">Collapse</span>
        </button>
      {/snippet}
    </Tooltip>
  </div>
</aside>

{#if ctxMenu}
  <div
    class="ctx-menu"
    style="left:{ctxMenu.x}px; top:{ctxMenu.y}px"
    role="menu"
    tabindex="-1"
  >
    {#if currentHome === ctxMenu.href}
      <div class="ctx-item is-current" role="menuitem">
        <Check size={14} class="shrink-0" />
        <span>{m.nav_isHome()}</span>
      </div>
    {:else}
      <button type="button" class="ctx-item" role="menuitem" onclick={() => setAsHome(ctxMenu!.href)}>
        <Star size={14} class="shrink-0" />
        <span>{m.nav_setAsHome()}</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  /* Rows keep their height and the nav scrolls instead of squishing them.
     Scrollbar hidden (content still scrolls via wheel/trackpad). */
  .sidebar-nav {
    scrollbar-width: none; /* Firefox */
  }
  .sidebar-nav::-webkit-scrollbar {
    width: 0;
    height: 0;
  }
  .sidebar-nav > :global(*) {
    flex-shrink: 0;
  }
  .nav-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: 2.25rem;
    padding: 0 0.625rem;
    border-radius: var(--radius-md);
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--color-muted);
    text-decoration: none;
    white-space: nowrap;
    position: relative;
    transition:
      color var(--duration-fast) var(--ease-standard),
      background-color var(--duration-fast) var(--ease-standard);
  }
  .nav-row.sub-item {
    margin-left: 0.5rem;
  }
  .collapse-toggle {
    display: none;
  }
  @media (min-width: 48rem) {
    .collapse-toggle {
      display: flex;
    }
  }
  .nav-row :global(.nav-icon) {
    opacity: 0.75;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }
  .nav-row:hover {
    color: var(--color-foreground);
    background: rgba(255, 255, 255, 0.05);
  }
  .nav-row:hover :global(.nav-icon) {
    opacity: 1;
  }
  .nav-row :global(.home-pin) {
    margin-left: auto;
    opacity: 0.5;
    color: var(--color-accent);
  }
  .nav-active.accent {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    font-weight: 600;
  }
  .nav-active.accent :global(.nav-icon) {
    opacity: 1;
    color: var(--color-accent);
  }
  .nav-active.brand {
    color: var(--color-brand-pink);
    background: color-mix(in srgb, var(--color-brand-pink) 12%, transparent);
    font-weight: 600;
  }
  .nav-active.brand :global(.nav-icon) {
    opacity: 1;
    color: var(--color-brand-pink);
  }
  /* "You are here" left indicator bar */
  .nav-active::before {
    content: '';
    position: absolute;
    left: -0.5rem;
    top: 50%;
    transform: translateY(-50%);
    width: 3px;
    height: 1.1rem;
    border-radius: 0 2px 2px 0;
    background: currentColor;
    animation: indicator-in 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .nav-group-head {
    padding: 0.5rem 0.625rem 0.25rem;
  }
  .nav-subhead {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    width: 100%;
    padding: 0.4rem 0.625rem 0.2rem;
    background: none;
    border: none;
    cursor: pointer;
    color: color-mix(in srgb, var(--color-foreground) 52%, transparent);
    text-align: left;
  }
  .nav-subhead:hover {
    color: var(--color-foreground);
  }

  /* ── Top utility row (Reliability + Marketplace) ── */
  .top-row {
    display: flex;
    flex-direction: row;
    gap: 0.375rem;
    padding: 0.25rem 0.5rem;
    align-items: center;
  }
  .top-row.is-collapsed {
    flex-direction: column;
  }
  .top-pill {
    display: flex;
    align-items: center;
    /* gap:0 — the label owns its own (animated) left margin so a collapsed
       label leaves ZERO trailing space and the icon stays perfectly centered. */
    gap: 0;
    height: 2rem;
    min-width: 2rem;
    padding: 0 0.4rem;
    border-radius: var(--radius-md);
    color: var(--color-muted);
    text-decoration: none;
    overflow: hidden;
    /* Smoothly resize the pill as its label expands/collapses. */
    transition:
      color var(--duration-fast) var(--ease-standard),
      background-color var(--duration-fast) var(--ease-standard),
      width 260ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  /* Inactive pills are square so their icon is dead-centered. */
  .top-pill:not(.active) {
    justify-content: center;
    width: 2rem;
  }
  .top-pill:hover {
    color: var(--color-foreground);
    background: rgba(255, 255, 255, 0.05);
  }
  .top-pill.active {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    justify-content: flex-start;
    /* Content-sized (icon + expanding label) so width animates with the label
       instead of snapping wide via flex-grow. */
    flex: 0 1 auto;
    padding: 0 0.6rem;
  }
  .top-label {
    max-width: 0;
    margin-left: 0;
    opacity: 0;
    overflow: hidden;
    white-space: nowrap;
    font-size: 0.8125rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    transition:
      max-width 260ms cubic-bezier(0.22, 1, 0.36, 1),
      margin-left 260ms cubic-bezier(0.22, 1, 0.36, 1),
      opacity 200ms ease;
  }
  .top-label.show {
    max-width: 140px;
    margin-left: 0.5rem;
    opacity: 1;
  }

  @keyframes indicator-in {
    from {
      transform: translateY(-50%) scaleY(0.3);
      opacity: 0;
    }
    to {
      transform: translateY(-50%) scaleY(1);
      opacity: 1;
    }
  }

  /* ── Right-click context menu ── */
  .ctx-menu {
    position: fixed;
    z-index: 70;
    min-width: 13rem;
    padding: 0.25rem;
    border-radius: var(--radius-md);
    background: var(--color-bg2, #1a1a1f);
    border: 1px solid var(--color-border, var(--hairline));
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
  }
  .ctx-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.45rem 0.6rem;
    border: none;
    background: none;
    border-radius: var(--radius-sm);
    color: var(--color-foreground);
    font-size: 0.8125rem;
    text-align: left;
    cursor: pointer;
  }
  .ctx-item:hover {
    background: color-mix(in srgb, var(--color-accent) 14%, transparent);
    color: var(--color-accent);
  }
  .ctx-item.is-current {
    color: var(--color-accent);
    cursor: default;
  }
</style>
