<script lang="ts">
  import { canonicalPath } from '$lib/canonical-path';
  // Mobile-only header (< md). At md+ the sidebar carries brand + host + nav,
  // and the floating DynamicIsland carries the global actions.
  import Sheet from '$lib/components/ui/foundations/Sheet.svelte';
  import { utilityLinks, hasVisibleSectionItems } from './utility-links';
  import HostPill from '../hosts/HostPill.svelte';
  import ProfileMenu from './ProfileMenu.svelte';
  import NotificationsPopup from './NotificationsPopup.svelte';
  import MinionLogo from './MinionLogo.svelte';
  import CompanySwitcher from './CompanySwitcher.svelte';
  import { getNavSections, type Section, type SectionItem } from './sections';
  import { readNavOrder, orderSections, orderItems } from './nav-order';
  import { pluginNavState } from '$lib/state/plugin-nav.svelte';
  import { canViewPath } from '$lib/access/can.svelte';
  import { togglePalette } from '$lib/state/ui/command-palette.svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import { Settings, Menu, X, Search, Bell, LogOut, User } from 'lucide-svelte';
  import NavIcon from './NavIcon.svelte';
  import {
    notifications,
    subscribeNotificationsPolling,
  } from '$lib/state/features/notifications.svelte';
  import { onMount } from 'svelte';
  import { userState, logout } from '$lib/state/features/user.svelte';
  import { Button } from '$lib/components/ui';

  // Same call as Sidebar's desktop nav (mobile-parity: R2) — getNavSections
  // composes static + dynamic sections kind-aware, merging Pulse/My Work
  // into the "My Space" group for personal orgs.
  const allSections = $derived<Section[]>(
    getNavSections(
      page.data.activeOrgKind,
      pluginNavState.controlCenters,
      pluginNavState.enabledByPluginId,
    ),
  );
  // Honor the user's drag-reordered sidebar order here too (same prefs source),
  // so desktop nav and the mobile hamburger stay consistent.
  const navOrder = $derived(readNavOrder(page.data));
  const orderedSections = $derived(orderSections(allSections, navOrder));
  function isActive(item: SectionItem): boolean {
    return item.activeWhen
      ? item.activeWhen(page.url)
      : item.matcher(canonicalPath(page.url.pathname));
  }
  const topItems = $derived(utilityLinks(canViewPath));
  const isSettings = $derived(canonicalPath(page.url.pathname).startsWith('/settings'));
  const isWorkforce = $derived(canonicalPath(page.url.pathname).startsWith('/workforce'));

  let mobileMenuOpen = $state(false);
  function toggleMobileMenu() {
    notificationsOpen = false;
    mobileMenuOpen = !mobileMenuOpen;
  }
  function closeMobileMenu() {
    mobileMenuOpen = false;
  }

  let notificationsOpen = $state(false);

  const displayName = $derived(userState.user?.displayName ?? userState.user?.email ?? '');
  const email = $derived(userState.user?.email ?? '');

  onMount(() => {
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

    <div class="shrink-0"><ProfileMenu /></div>
  </div>

  <Sheet
    bind:open={mobileMenuOpen}
    title={m.a11y4_sectionNavigation()}
    placement="left"
    size="sm"
    class="mobile-navigation-sheet"
  >
    {#snippet footer()}
      <div
        class="mobile-menu-footer shrink-0 border-t border-[var(--hairline)] px-2 py-2 flex flex-col gap-1 bg-bg2"
      >
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
    {/snippet}
    <nav class="mobile-menu-nav flex flex-col sm:flex-row sm:gap-4 px-2 pt-2 pb-1">
      <div class="flex-1 min-w-0">
        {#each orderedSections as section (section.id)}
          {@const items = orderItems(section, navOrder).filter((i) => canViewPath(i.href))}

          {#if hasVisibleSectionItems(section, canViewPath)}
            <div
              class="px-3 py-1 text-[length:var(--font-size-telemetry)] font-semibold uppercase tracking-wider text-muted-strong mt-1"
            >
              {section.label}
            </div>
            {#each items as item (item.href)}
              <a
                href={item.href}
                aria-current={isActive(item) ? 'page' : undefined}
                class="mobile-nav-link {section.tone === 'brand' ? 'brand' : ''} {isActive(item)
                  ? section.tone === 'brand'
                    ? 'active-brand'
                    : 'active'
                  : ''}"
                onclick={closeMobileMenu}
              >
                <NavIcon icon={item.icon} size={16} />
                <span>{item.label}</span>
              </a>
            {/each}
            {#each section.subsections ?? [] as sub (sub.id)}
              {@const subItems = sub.items.filter((i) => canViewPath(i.href))}
              {#if subItems.length}
                <div
                  class="px-5 py-1 text-[length:var(--font-size-telemetry)] font-medium uppercase tracking-wider text-muted mt-0.5"
                >
                  {sub.label}
                </div>
                {#each subItems as item (item.href)}
                  <a
                    href={item.href}
                    aria-current={isActive(item) ? 'page' : undefined}
                    class="mobile-nav-link {isActive(item) ? 'active' : ''}"
                    onclick={closeMobileMenu}
                  >
                    <NavIcon icon={item.icon} size={16} />
                    <span>{item.label}</span>
                  </a>
                {/each}
              {/if}
            {/each}
          {/if}
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
  .mobile-nav-link.brand {
    color: var(--color-brand-pink);
  }
  .mobile-nav-link.active-brand {
    color: var(--color-brand-pink);
    background: color-mix(in srgb, var(--color-brand-pink) 15%, transparent);
    font-weight: 600;
  }
  /* Active left indicator bar — matches desktop sidebar */
  .mobile-nav-link.active::before,
  .mobile-nav-link.active-brand::before {
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
    .mobile-nav-link.active::before,
    .mobile-nav-link.active-brand::before {
      animation: none;
      transition: none;
    }
  }
</style>
