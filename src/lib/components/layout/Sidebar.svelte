<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { Activity, Settings, PanelLeftClose, PanelLeft } from 'lucide-svelte';
  import NavIcon from './NavIcon.svelte';
  import Tooltip from './Tooltip.svelte';
  import {
    getSections,
    gateSections,
    getDynamicPluginsSection,
    DOMAIN_LABEL,
    type Section,
  } from './sections';
  import MinionLogo from './MinionLogo.svelte';
  import HostPill from '../hosts/HostPill.svelte';
  import { pluginNavState } from '$lib/state/plugin-nav.svelte';
  import { canClient } from '$lib/access/can.svelte';
  import * as m from '$lib/paraglide/messages';

  const staticSections = $derived(gateSections(getSections(), pluginNavState.enabledByPluginId));
  const pluginsSection = $derived(getDynamicPluginsSection(pluginNavState.controlCenters));
  const navSections = $derived<Section[]>(
    pluginsSection ? [...staticSections, pluginsSection] : staticSections
  );

  const showReliability = $derived(canClient('reliability.monitor'));
  const isReliability = $derived(page.url.pathname.startsWith('/reliability'));
  const isSettings = $derived(page.url.pathname.startsWith('/settings'));

  // Three responsive tiers:
  //   <md   : sidebar hidden — the mobile hamburger (Topbar) takes over.
  //   md–lg : forced mini icon rail (56px) — the "midpoint" before the hamburger.
  //   lg+   : honors the user's collapse preference (expanded 224px / mini 56px).
  // Expanded affordances are all gated on lg+, so md–lg always renders the rail
  // regardless of preference; the toggle is hidden below lg (see .collapse-toggle).
  let collapsed = $state(false);
  // Track the lg breakpoint so we can show hover tooltips whenever the rail is in
  // icon-only mode — that's `collapsed` (lg+ preference) OR the md–lg forced rail.
  let isLg = $state(true);
  onMount(() => {
    collapsed = localStorage.getItem('hub-sidebar-collapsed') === '1';
    const mq = window.matchMedia('(min-width: 64rem)');
    const sync = () => (isLg = mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  });
  function toggle() {
    collapsed = !collapsed;
    localStorage.setItem('hub-sidebar-collapsed', collapsed ? '1' : '0');
  }

  // Labels are hidden (so a tooltip earns its keep) whenever we're not in the
  // lg+ expanded state.
  const showTooltips = $derived(collapsed || !isLg);

  // Expanded width/labels/heads unlock only at lg+; below that we stay a mini rail.
  const widthCls = $derived(collapsed ? 'w-14' : 'w-14 lg:w-[224px]');
  const labelCls = $derived(collapsed ? 'hidden' : 'hidden lg:inline');
  const headCls = $derived(collapsed ? 'hidden' : 'hidden lg:block');
  // Center icons in the mini rail; left-align with labels only in the lg+ expanded state.
  const rowJustify = $derived(collapsed ? 'justify-center' : 'justify-center lg:justify-start');
</script>

<aside
  class="surface-1 hidden md:flex flex-col shrink-0 {widthCls} h-full border-r border-[var(--hairline)] transition-[width] duration-200 ease-[cubic-bezier(0.2,0,0,1)] z-40"
  aria-label="Primary"
>
  <!-- Brand + active gateway (relocated from the topbar) -->
  <div class="shrink-0 px-2 pt-3 pb-2 flex flex-col gap-2">
    <a
      href="/"
      class="flex items-center {collapsed ? 'justify-center' : 'justify-center lg:justify-start'} gap-2 h-9 px-1.5 rounded-[var(--radius-md)] hover:bg-white/[0.05] transition-colors duration-[150ms] group"
      aria-label="Minion Hub"
    >
      {#if collapsed}
        <MinionLogo size="sm" />
      {:else}
        <span class="hidden lg:flex items-center leading-none">
          <span class="font-black text-sm tracking-wide uppercase text-brand-pink group-hover:text-brand-pink/90 transition-colors">MINION</span>
          <span class="font-semibold text-sm text-foreground/80 ml-1 group-hover:text-foreground transition-colors">hub</span>
        </span>
        <span class="lg:hidden"><MinionLogo size="sm" /></span>
      {/if}
    </a>
    <div class={collapsed ? 'hidden' : 'hidden lg:block'}>
      <HostPill />
    </div>
  </div>
  <div class="h-px bg-[var(--hairline)] mx-2 mb-1"></div>

  <nav class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 py-2 flex flex-col gap-0.5">
    {#if showReliability}
      <Tooltip label={m.nav_reliability()} id="nav-tip-reliability" placement="right" disabled={!showTooltips} openDelay={150}>
        {#snippet children(trigger)}
          <a
            href="/reliability"
            {...trigger}
            class="nav-row {rowJustify} {isReliability ? 'nav-active accent' : ''}"
            aria-label={m.nav_reliability()}
          >
            <Activity size={18} class="nav-icon shrink-0" />
            <span class="nav-label {labelCls}">{m.nav_reliability()}</span>
          </a>
        {/snippet}
      </Tooltip>
      <div class="h-px bg-[var(--hairline)] my-1.5 mx-1"></div>
    {/if}

    {#each navSections as section, si (section.id)}
      {@const items = section.items.filter((it) => !it.requires || canClient(it.requires))}
      {#if items.length}
        {#if section.domain !== navSections[si - 1]?.domain}
          <div class="nav-domain-head {headCls}">{DOMAIN_LABEL[section.domain]}</div>
        {/if}
        {#if section.label !== DOMAIN_LABEL[section.domain]}
          <div class="nav-group-head t-label {headCls}">{section.label}</div>
        {/if}
        {#each items as item (item.href)}
          {@const active = item.matcher(page.url.pathname)}
          <Tooltip label={item.label} id={`nav-tip-${item.href}`} placement="right" disabled={!showTooltips} openDelay={150}>
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
              >
                <NavIcon icon={item.icon} size={18} class="nav-icon shrink-0" />
                <span class="nav-label {labelCls}">{item.label}</span>
              </a>
            {/snippet}
          </Tooltip>
        {/each}
        <div class="h-px bg-[var(--hairline)] my-1.5 mx-1"></div>
      {/if}
    {/each}
  </nav>

  <!-- Pinned footer: Settings + collapse toggle -->
  <div class="shrink-0 px-2 py-2 border-t border-[var(--hairline)] flex flex-col gap-0.5">
    <Tooltip label={m.nav_settings()} id="nav-tip-settings" placement="right" disabled={!showTooltips} openDelay={150}>
      {#snippet children(trigger)}
        <a
          href="/settings"
          {...trigger}
          class="nav-row {rowJustify} {isSettings ? 'nav-active accent' : ''}"
          aria-label={m.nav_settings()}
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
    >
      {#snippet children(trigger)}
        <button
          type="button"
          onclick={toggle}
          {...trigger}
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

<style>
  .nav-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    height: 2.25rem;
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
  /* The collapse toggle is only meaningful at lg+ (md–lg is a forced mini rail).
     Hidden here via scoped CSS rather than Tailwind `hidden lg:flex`, because the
     scoped `.nav-row { display: flex }` rule outranks Tailwind's `.hidden` utility
     and would otherwise leave the button visible — but inert — in the rail band.
     64rem is the default Tailwind `lg` breakpoint. */
  .collapse-toggle {
    display: none;
  }
  @media (min-width: 64rem) {
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
  /* Top-level product domain super-label (Control plane / Gateway) —
     stronger than the section group-head so the two surfaces read apart. */
  .nav-domain-head {
    padding: 0.65rem 0.625rem 0.1rem;
    font-size: 0.625rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: color-mix(in srgb, var(--color-foreground) 52%, transparent);
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
</style>
