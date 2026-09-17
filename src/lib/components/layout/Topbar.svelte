<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
  // Mobile-only header (< md). At md+ the sidebar carries brand + host + nav,
  // and the floating DynamicIsland carries the global actions.
  import Sheet from '$lib/components/ui/foundations/Sheet.svelte';
  import { utilityLinks } from './utility-links';
  import HostPill from '../hosts/HostPill.svelte';
  import ProfileMenu from './ProfileMenu.svelte';
  import EnvBadge from './EnvBadge.svelte';
  import NotificationsPopup from './NotificationsPopup.svelte';
  import MinionLogo from './MinionLogo.svelte';
  import CompanySwitcher from './CompanySwitcher.svelte';
  import { canViewPath } from '$lib/access/can.svelte';
  import { navMode, navModuleData } from '$lib/state/ui/nav-mode.svelte';
  import { visibleModules, type ModuleNavItem } from '$lib/nav/modules';
  import { togglePalette } from '$lib/state/ui/command-palette.svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import {
    Settings,
    Menu,
    X,
    Search,
    Bell,
    LogOut,
    User,
    ChevronDown,
    ChevronsUpDown,
    Check,
    LayoutList,
  } from 'lucide-svelte';
  import NavIcon from './NavIcon.svelte';
  import {
    notifications,
    subscribeNotificationsPolling,
  } from '$lib/state/features/notifications.svelte';
  import { onMount } from 'svelte';
  import { userState, logout } from '$lib/state/features/user.svelte';
  import { Button, iconSizes } from '$lib/components/ui';

  function isActive(item: ModuleNavItem): boolean {
    return item.activeWhen
      ? item.activeWhen(page.url)
      : item.matcher(canonicalPath(page.url.pathname));
  }
  const topItems = $derived(utilityLinks(canViewPath));
  const isSettings = $derived(canonicalPath(page.url.pathname).startsWith('/settings'));
  const isWorkforce = $derived(canonicalPath(page.url.pathname).startsWith('/workforce'));

  // Mobile is ALWAYS module-scoped, for every role — `navMode.isModule` only
  // gates the DESKTOP Sidebar's full-vs-module view (untouched here) and is
  // deliberately NOT consulted below. `navMode.activeModule` itself already
  // resolves unconditionally: the module the CURRENT ROUTE belongs to, else
  // the last module picked from this same picker, else the first module the
  // user can see (`visibleModules()[0]`) — that fallback also covers routes
  // no module claims (e.g. `/notifications`); `/home` itself resolves to the
  // Organization module via its own matcher, so it's covered too. This is
  // the exact getter Sidebar's module view reads — no forked list.
  const moduleItems = $derived(navMode.activeModule?.items ?? []);

  // Compact module picker for the sheet header — the only way to move
  // between modules on mobile now that the sheet never shows the full
  // section list. Same `visibleModules()` data ModuleSwitcher.svelte reads,
  // but NOT that component: its Zag Dropdown portals its menu to
  // `document.body`, which renders behind a native `showModal()` <dialog>'s
  // top layer (the sheet), so the popover opened and was immediately
  // unreachable/invisible. This picker never leaves the sheet's own DOM
  // subtree, so it has no top-layer conflict.
  const pickerModules = $derived(visibleModules(navModuleData(), canViewPath));
  const pickerActive = $derived(navMode.activeModule);
  const PickerIcon = $derived(pickerActive?.icon ?? LayoutList);
  const pickerLabel = $derived(pickerActive?.label ?? m.nav_allSections());

  let modulePickerOpen = $state(false);
  let modulePickerRoot = $state<HTMLDivElement | null>(null);
  function selectModule(id: string) {
    modulePickerOpen = false;
    const mod = pickerModules.find((m) => m.id === id);
    if (!mod) return;
    navMode.pickModule(mod.id);
    void goto(mod.href);
  }
  function onPickerPointerDown(e: PointerEvent) {
    if (modulePickerOpen && modulePickerRoot && !modulePickerRoot.contains(e.target as Node)) {
      modulePickerOpen = false;
    }
  }
  function onPickerKeydown(e: KeyboardEvent) {
    if (modulePickerOpen && e.key === 'Escape') {
      modulePickerOpen = false;
      e.stopPropagation();
    }
  }

  let mobileMenuOpen = $state(false);
  function toggleMobileMenu() {
    notificationsOpen = false;
    mobileMenuOpen = !mobileMenuOpen;
  }
  function closeMobileMenu() {
    mobileMenuOpen = false;
  }
  // Covers every close path, including the Sheet's own X/backdrop/Escape,
  // which set `mobileMenuOpen` directly through the two-way `bind:open`
  // rather than through `closeMobileMenu()`.
  $effect(() => {
    if (!mobileMenuOpen) modulePickerOpen = false;
  });

  let notificationsOpen = $state(false);

  const displayName = $derived(userState.user?.displayName ?? userState.user?.email ?? '');
  const email = $derived(userState.user?.email ?? '');

  // Secondary utility group (Reliability/Marketplace/Cloud/Killswitches,
  // Settings, Notifications, account, sign out) — collapsed by default,
  // remembered per session so it doesn't re-collapse on every open.
  const MORE_KEY = 'hub-mobile-nav-more-expanded';
  let moreExpanded = $state(false);
  function toggleMore() {
    moreExpanded = !moreExpanded;
    try {
      sessionStorage.setItem(MORE_KEY, moreExpanded ? '1' : '0');
    } catch {
      /* private mode / storage disabled — session-only default is fine */
    }
  }

  onMount(() => {
    navMode.hydrate();
    try {
      moreExpanded = sessionStorage.getItem(MORE_KEY) === '1';
    } catch {
      /* ignore */
    }
    const stopNotifications = subscribeNotificationsPolling();
    const desktop = window.matchMedia('(min-width: 48rem)');
    const closeOnDesktop = () => {
      if (desktop.matches) {
        mobileMenuOpen = false;
        notificationsOpen = false;
      }
    };
    closeOnDesktop();
    desktop.addEventListener('change', closeOnDesktop);
    return () => {
      desktop.removeEventListener('change', closeOnDesktop);
      stopNotifications();
    };
  });
</script>

<svelte:document onpointerdown={onPickerPointerDown} onkeydown={onPickerKeydown} />

<header
  class="mobile-topbar md:hidden shrink-0 relative z-[var(--layer-navigation,20)] bg-bg/95 backdrop-blur-md border-b border-[var(--hairline)] h-14"
>
  <div class="topbar-controls relative flex items-center h-full px-3 gap-2">
    <Button
      variant="ghost"
      size="xs"
      type="button"
      onclick={toggleMobileMenu}
      class="flex items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-foreground hover:bg-bg3 transition-all duration-[var(--duration-fast)]"
      aria-label={m.topbar_toggleMenu()}
      aria-expanded={mobileMenuOpen}
    >
      {#if mobileMenuOpen}<X size={20} />{:else}<Menu size={20} />{/if}
    </Button>

    <a href="/" class="flex items-center gap-2 no-underline group shrink-0" aria-label="Minion Hub">
      <MinionLogo size="sm" />
      <span class="mobile-brand-wordmark flex items-center leading-none">
        <span class="font-black text-sm tracking-wide uppercase text-brand-pink">MINION</span>
        <span class="font-semibold text-sm text-foreground/80 ml-1">hub</span>
      </span>
    </a>

    <div class="h-5 w-px bg-[var(--hairline)] mx-1 shrink-0"></div>
    <div class="shrink-0 min-w-0"><HostPill /></div>

    <div class="flex-1 min-w-0"></div>

    <Button
      variant="ghost"
      size="xs"
      type="button"
      onclick={() => togglePalette()}
      class="flex items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-foreground hover:bg-bg3 transition-all duration-[var(--duration-fast)]"
      aria-label="Open command palette"
      title="Command palette"
    >
      <Search size={18} />
    </Button>

    <!-- Notification bell -->
    <div class="relative">
      <Button
        variant="ghost"
        size="xs"
        type="button"
        onclick={() => (notificationsOpen = !notificationsOpen)}
        class="flex items-center justify-center w-9 h-9 rounded-lg text-muted hover:text-foreground hover:bg-bg3 transition-all duration-[var(--duration-fast)] relative"
        aria-label="{notifications.badgeCount} notifications"
        title="Notifications"
        aria-expanded={notificationsOpen}
      >
        <Bell size={18} />
        {#if notifications.hasPending}
          <span
            class="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded-full bg-destructive text-[length:var(--font-size-telemetry)] font-bold text-accent-foreground leading-none"
          >
            {notifications.badgeCount > 99 ? '99+' : notifications.badgeCount}
          </span>
        {/if}
      </Button>
      <NotificationsPopup bind:open={notificationsOpen} />
    </div>

    <div class="shrink-0"><EnvBadge /></div>
    <div class="shrink-0"><ProfileMenu /></div>
  </div>

  <Sheet
    bind:open={mobileMenuOpen}
    labelledBy="mobile-nav-sheet-title"
    placement="left"
    size="sm"
    class="mobile-navigation-sheet"
  >
    {#snippet header()}
      <h2 id="mobile-nav-sheet-title" class="sr-only">{m.a11y4_sectionNavigation()}</h2>
      <div class="module-picker" bind:this={modulePickerRoot}>
        <Button
          variant="ghost"
          size="sm"
          type="button"
          class="module-picker-trigger"
          aria-haspopup="menu"
          aria-expanded={modulePickerOpen}
          onclick={() => (modulePickerOpen = !modulePickerOpen)}
        >
          <PickerIcon size={iconSizes.md} class="shrink-0" />
          <span class="truncate">{pickerLabel}</span>
          <ChevronsUpDown size={iconSizes.sm} class="module-picker-chev shrink-0" />
        </Button>
        {#if modulePickerOpen}
          <div class="module-picker-menu" role="menu">
            {#each pickerModules as mod (mod.id)}
              {@const ModIcon = mod.icon}
              <Button
                variant="ghost"
                size="xs"
                type="button"
                class="module-picker-item"
                role="menuitem"
                aria-current={pickerActive?.id === mod.id ? 'true' : undefined}
                onclick={() => selectModule(mod.id)}
              >
                <NavIcon icon={ModIcon} size={iconSizes.sm} class="shrink-0" />
                <span class="truncate">{mod.label}</span>
                {#if pickerActive?.id === mod.id}
                  <Check size={iconSizes.sm} class="module-picker-check shrink-0" />
                {/if}
              </Button>
            {/each}
          </div>
        {/if}
      </div>
    {/snippet}
    {#snippet footer()}
      <div class="mobile-menu-footer shrink-0 border-t border-[var(--hairline)] bg-bg2">
        <Button
          variant="ghost"
          size="sm"
          type="button"
          class="mobile-more-toggle"
          aria-expanded={moreExpanded}
          aria-controls="mobile-nav-more"
          onclick={toggleMore}
        >
          <ChevronDown
            size={iconSizes.sm}
            class="mobile-more-chevron {moreExpanded ? 'open' : ''}"
          />
          <span>{m.nav_moreOptions()}</span>
        </Button>
        {#if moreExpanded}
          <div id="mobile-nav-more" class="px-2 pb-2 flex flex-col gap-1">
            {#each topItems as item (item.href)}
              {@const Icon = item.icon}
              {@const active = canonicalPath(page.url.pathname).startsWith(item.href)}
              <a
                href={item.href}
                class="mobile-nav-link {active ? 'active' : ''}"
                aria-current={active ? 'page' : undefined}
                onclick={closeMobileMenu}
              >
                <Icon size={16} /><span>{item.label}</span>
              </a>
            {/each}

            <!-- Settings -->
            <a
              href="/settings"
              class="mobile-nav-link text-xs {isSettings ? 'active' : ''}"
              onclick={closeMobileMenu}
            >
              <Settings size={15} />
              <span>{m.nav_settings()}</span>
            </a>

            <!-- Notifications link -->
            {#if canViewPath('/notifications')}
              <a href="/notifications" class="mobile-nav-link text-xs" onclick={closeMobileMenu}>
                <Bell size={15} />
                <span>{m.misc_notifications()}</span>
                {#if notifications.hasPending}
                  <span
                    class="ml-auto text-[length:var(--font-size-telemetry)] font-bold px-1.5 py-0.5 rounded-full bg-destructive text-accent-foreground leading-none"
                  >
                    {notifications.badgeCount > 99 ? '99+' : notifications.badgeCount}
                  </span>
                {/if}
              </a>
            {/if}

            <!-- User row -->
            <a href="/account" class="mobile-nav-link text-xs mt-1" onclick={closeMobileMenu}>
              <User size={15} />
              <span class="truncate">{displayName || email}</span>
            </a>

            <!-- Logout -->
            <Button
              variant="ghost"
              size="xs"
              type="button"
              onclick={logout}
              class="mobile-nav-link text-xs text-muted hover:text-destructive"
            >
              <LogOut size={15} />
              <span>{m.profile_logout()}</span>
            </Button>

            {#if isWorkforce}
              <div class="px-3 py-2"><CompanySwitcher /></div>
            {/if}
          </div>
        {/if}
      </div>
    {/snippet}
    <nav class="mobile-menu-nav flex flex-col sm:flex-row sm:gap-4 px-2 pt-2 pb-1">
      <div class="flex-1 min-w-0">
        <!-- Mobile is ALWAYS module-scoped, regardless of navMode.isModule
             (which only gates the desktop Sidebar's full-vs-module view).
             `moduleItems` reads `navMode.activeModule` unconditionally — the
             module the CURRENT ROUTE belongs to, falling back to the last
             picked module, else the first visible one — so a full-nav role
             (owner/admin/manager) sees the same one-module list a module-mode
             role does; the header picker is the only way to see another
             module's pages. Same item derivation Sidebar's module view uses
             (`navMode.activeModule.items`), no forked list. -->
        {#each moduleItems as item, i (item.id)}
          {#if item.group && item.group !== moduleItems[i - 1]?.group}
            <div
              class="px-3 py-1 text-[length:var(--font-size-telemetry)] font-semibold uppercase tracking-wider text-muted-strong mt-1"
            >
              {item.group}
            </div>
          {/if}
          <a
            href={item.href}
            aria-current={isActive(item) ? 'page' : undefined}
            class="mobile-nav-link {item.indent ? 'sub-item' : ''} {isActive(item) ? 'active' : ''}"
            onclick={closeMobileMenu}
          >
            <NavIcon icon={item.icon} size={iconSizes.md} />
            <span>{item.label}</span>
          </a>
        {/each}
      </div>
    </nav>
  </Sheet>
</header>

<style>
  .mobile-topbar :global(button) {
    min-width: var(--control-height-touch);
    min-height: var(--control-height-touch);
    flex-shrink: 0;
  }
  @media (max-width: 400px) {
    .mobile-brand-wordmark {
      display: none;
    }
  }
  .mobile-menu-nav {
    overscroll-behavior: contain;
  }
  .mobile-menu-footer {
    width: 100%;
    max-width: 100%;
    max-height: 50dvh;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  /* `.mobile-more-toggle`/`.mobile-more-chevron` are forwarded `class` props
     into the shared `Button`/lucide icon components, so they render on
     elements this component didn't create directly — plain scoped selectors
     never match them, hence `:global()` anchored on a local ancestor. */
  .mobile-menu-footer :global(.mobile-more-toggle) {
    width: 100%;
    min-height: var(--control-height-touch);
    padding: var(--space-2) var(--space-3);
    color: var(--color-text-secondary, var(--color-muted));
  }
  .mobile-menu-footer :global(.mobile-more-toggle:hover) {
    color: var(--color-text-primary, var(--color-foreground));
    background: var(--color-bg3);
  }
  .mobile-menu-footer :global(.mobile-more-toggle > span) {
    flex: 1;
    justify-content: flex-start;
    gap: var(--space-2);
  }
  .mobile-menu-footer :global(.mobile-more-chevron) {
    flex-shrink: 0;
    transition: transform var(--duration-fast) var(--ease-standard);
  }
  .mobile-menu-footer :global(.mobile-more-chevron.open) {
    transform: rotate(180deg);
  }
  @media (prefers-reduced-motion: reduce) {
    .mobile-menu-footer :global(.mobile-more-chevron) {
      transition: none;
    }
  }

  /* Compact module picker (sheet header) — a hand-rolled absolute-positioned
     panel, NOT a Zag Dropdown: Zag portals its menu to `document.body`, which
     renders behind a native `showModal()` <dialog>'s top layer, so it would
     open invisibly/unreachable inside this sheet. Everything here stays in
     the sheet's own DOM subtree instead (mirrors ColumnFilter.svelte's
     hand-rolled outside-click pattern). */
  .module-picker {
    position: relative;
    min-width: 0;
  }
  .module-picker :global(.module-picker-trigger) {
    width: 100%;
    justify-content: flex-start;
  }
  .module-picker :global(.module-picker-trigger > span) {
    flex: 1;
    justify-content: flex-start;
    gap: var(--space-2);
    min-width: 0;
  }
  .module-picker-menu {
    position: absolute;
    top: calc(100% + var(--space-1));
    left: 0;
    z-index: var(--layer-dropdown);
    min-width: 14rem;
    max-width: calc(100vw - 2 * var(--space-4));
    max-height: 60vh;
    overflow-y: auto;
    background: var(--color-overlay);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-overlay);
    padding: var(--space-1);
  }
  .module-picker :global(.module-picker-item) {
    width: 100%;
    min-height: var(--control-height-touch);
    justify-content: flex-start;
  }
  .module-picker :global(.module-picker-item > span) {
    flex: 1;
    justify-content: flex-start;
    gap: var(--space-2);
    min-width: 0;
  }
  .module-picker :global(.module-picker-check) {
    color: var(--color-accent);
    margin-left: auto;
  }

  .mobile-nav-link {
    min-height: var(--control-height-touch);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-lg);
    font-size: var(--font-size-body);
    font-weight: 500;
    color: var(--color-muted);
    text-decoration: none;
    position: relative;
    transition: all var(--duration-fast) var(--ease-standard);
  }
  .mobile-nav-link:hover {
    color: var(--color-foreground);
    background: var(--color-bg3);
  }
  .mobile-nav-link.active {
    color: var(--color-accent);
    background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    font-weight: 600;
  }
  /* Module view's nested item (e.g. CRM Insights under CRM Dashboard) —
     mirrors Sidebar's `.nav-row.sub-item`. */
  .mobile-nav-link.sub-item {
    margin-left: var(--space-2);
  }
  /* Active left indicator bar — matches desktop sidebar. (No `.active-brand`
     variant here: mobile's module-scoped list has no brand-toned section —
     that tone only existed in the removed full-section-list branch.) */
  .mobile-nav-link.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 2.5px;
    height: 1rem;
    border-radius: 0 2px 2px 0;
    background: currentColor;
    animation: indicator-in 220ms cubic-bezier(0.22, 1, 0.36, 1);
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

  /* Pinned footer: slightly different hover bg for contrast */
  .mobile-menu-footer .mobile-nav-link:hover {
    background: var(--color-bg3);
  }
  @media (prefers-reduced-motion: reduce) {
    .mobile-nav-link,
    .mobile-nav-link.active::before {
      animation: none;
      transition: none;
    }
  }
</style>
