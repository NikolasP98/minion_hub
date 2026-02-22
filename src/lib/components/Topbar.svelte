<script lang="ts">
  import HostPill from './HostPill.svelte';
  import ProfileMenu from './ProfileMenu.svelte';
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';
  import { locale } from '$lib/state/locale.svelte';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import {
    Wrench,
    Users,
    Activity,
    SlidersHorizontal,
    Store,
    Settings,
  } from 'lucide-svelte';

  const isHome = $derived(page.url.pathname === '/');
  const isMarketplace = $derived(page.url.pathname.startsWith('/marketplace'));
  const isWorkshop = $derived(page.url.pathname.startsWith('/workshop'));
  const isUsers = $derived(page.url.pathname.startsWith('/users'));
  const isReliability = $derived(page.url.pathname.startsWith('/reliability'));
  const isConfig = $derived(page.url.pathname.startsWith('/config'));
  const isSettings = $derived(page.url.pathname.startsWith('/settings'));

  const subtitle = $derived(
    isMarketplace ? m.nav_marketplace() : isWorkshop ? m.nav_workshop() : 'hub'
  );
</script>

<header class="shrink-0 relative z-100 bg-bg/95 backdrop-blur-sm border-b border-border px-4.5 py-2.5 flex items-center gap-2">
  <div class="absolute inset-0 overflow-hidden pointer-events-none">
    <ScanLine speed={12} opacity={0.02} />
  </div>

  <!-- Left zone: host-specific -->
  <div class="flex items-center gap-2 shrink-0">
    <HostPill />
    <div class="w-px h-4 bg-border/60 mx-0.5 shrink-0"></div>
    <a href="/workshop" class="flex items-center gap-1.5 text-xs no-underline px-2.5 py-1 rounded-full border transition-all duration-150 {isWorkshop ? 'bg-accent/10 text-accent border-accent/30' : 'text-muted border-border hover:bg-bg3 hover:text-foreground'}">
      <Wrench size={12} /><span>{m.nav_workshop()}</span>
    </a>
    <a href="/users" class="flex items-center gap-1.5 text-xs no-underline px-2.5 py-1 rounded-full border transition-all duration-150 {isUsers ? 'bg-accent/10 text-accent border-accent/30' : 'text-muted border-border hover:bg-bg3 hover:text-foreground'}">
      <Users size={12} /><span>{m.nav_users()}</span>
    </a>
    <a href="/reliability" class="flex items-center gap-1.5 text-xs no-underline px-2.5 py-1 rounded-full border transition-all duration-150 {isReliability ? 'bg-accent/10 text-accent border-accent/30' : 'text-muted border-border hover:bg-bg3 hover:text-foreground'}">
      <Activity size={12} /><span>{m.nav_reliability()}</span>
    </a>
    <a href="/config" class="flex items-center gap-1.5 text-xs no-underline px-2.5 py-1 rounded-full border transition-all duration-150 {isConfig ? 'bg-accent/10 text-accent border-accent/30' : 'text-muted border-border hover:bg-bg3 hover:text-foreground'}">
      <SlidersHorizontal size={12} /><span>{m.nav_config()}</span>
    </a>
  </div>

  <!-- Center: brand -->
  <a href="/" class="ml-auto mr-auto flex items-center select-none leading-none no-underline transition-opacity duration-150 {isHome ? 'opacity-100' : 'opacity-80 hover:opacity-100'}" aria-label="Minion Hub">
    <span class="bg-brand-pink text-black font-black text-[15px] tracking-wide px-2.5 py-0.5 rounded-l-md uppercase">MINION</span>
    <span class="text-white font-bold text-[15px] px-2 py-0.5">{subtitle}</span>
  </a>

  <!-- Right zone: global -->
  <div class="flex items-center gap-2 shrink-0">
    <a href="/marketplace" class="flex items-center gap-1.5 text-xs no-underline px-2.5 py-1 rounded-full border transition-all duration-150 {isMarketplace ? 'bg-brand-pink/10 text-brand-pink border-brand-pink/30' : 'text-muted border-border hover:bg-bg3 hover:text-foreground'}">
      <Store size={12} /><span>{m.nav_marketplace()}</span>
    </a>
    <a href="/settings" class="flex items-center gap-1.5 text-xs no-underline px-2.5 py-1 rounded-full border transition-all duration-150 {isSettings ? 'bg-accent/10 text-accent border-accent/30' : 'text-muted border-border hover:bg-bg3 hover:text-foreground'}">
      <Settings size={12} /><span>{m.nav_settings()}</span>
    </a>
    <button
      onclick={locale.toggle}
      class="text-xs text-muted px-2.5 py-1 rounded-full border border-border transition-all duration-150 hover:bg-bg3 hover:text-foreground font-mono"
      aria-label={m.settings_language()}
    >
      {locale.current.toUpperCase()}
    </button>
    <ProfileMenu />
  </div>
</header>
