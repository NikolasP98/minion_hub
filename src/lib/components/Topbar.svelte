<script lang="ts">
  import HostPill from './HostPill.svelte';
  import { conn } from '$lib/state/connection.svelte';
  import { locale } from '$lib/state/locale.svelte';
  import StatusDot from '$lib/components/decorations/StatusDot.svelte';
  import ScanLine from '$lib/components/decorations/ScanLine.svelte';
  import { page } from '$app/stores';
  import * as m from '$lib/paraglide/messages';

  const dotStatus = $derived<'running' | 'thinking' | 'idle'>(
    conn.connected ? 'running' : conn.connecting ? 'thinking' : 'idle'
  );

  const connLabel = $derived(
    conn.connected ? m.conn_connected() : conn.connecting ? m.conn_connecting() : m.conn_notConnected()
  );

  const isMarketplace = $derived($page.url.pathname.startsWith('/marketplace'));
  const isWorkshop = $derived($page.url.pathname.startsWith('/workshop'));
  const isUsers = $derived($page.url.pathname.startsWith('/users'));
</script>

<header class="shrink-0 relative z-100 bg-bg/95 backdrop-blur-sm border-b border-border px-4.5 py-2.5 flex items-center gap-2.5">
  <div class="absolute inset-0 overflow-hidden pointer-events-none">
    <ScanLine speed={12} opacity={0.02} />
  </div>
  <HostPill />

  <StatusDot status={dotStatus} size="md" />
  <span class="text-xs text-muted whitespace-nowrap">{connLabel}</span>

  <div class="ml-auto mr-auto flex items-center select-none leading-none" aria-label="Minion Hub">
    <span class="bg-brand-pink text-black font-black text-[15px] tracking-wide px-2.5 py-0.5 rounded-l-md uppercase">MINION</span>
    <span class="text-white font-bold text-[15px] px-2 py-0.5">{isMarketplace ? m.nav_marketplace() : isWorkshop ? m.nav_workshop() : 'hub'}</span>
  </div>

  <a href="/marketplace" class="text-xs no-underline px-3 py-1 rounded-full border transition-all duration-150 {isMarketplace ? 'bg-brand-pink/10 text-brand-pink border-brand-pink/30' : 'text-muted border-border hover:bg-bg3 hover:text-foreground'}">{m.nav_marketplace()}</a>
  <a href="/workshop" class="text-xs no-underline px-3 py-1 rounded-full border transition-all duration-150 {isWorkshop ? 'bg-accent/10 text-accent border-accent/30' : 'text-muted border-border hover:bg-bg3 hover:text-foreground'}">{m.nav_workshop()}</a>
  <a href="/users" class="text-xs no-underline px-3 py-1 rounded-full border transition-all duration-150 {isUsers ? 'bg-accent/10 text-accent border-accent/30' : 'text-muted border-border hover:bg-bg3 hover:text-foreground'}">{m.nav_users()}</a>
  <a href="/reliability" class="text-xs text-muted no-underline px-3 py-1 rounded-full border border-border transition-all duration-150 hover:bg-bg3 hover:text-foreground">{m.nav_reliability()}</a>
  <a href="/config" class="text-xs text-muted no-underline px-3 py-1 rounded-full border border-border transition-all duration-150 hover:bg-bg3 hover:text-foreground">{m.nav_config()}</a>
  <a href="/settings" class="text-xs text-muted no-underline px-3 py-1 rounded-full border border-border transition-all duration-150 hover:bg-bg3 hover:text-foreground">{m.nav_settings()}</a>

  <button
    onclick={locale.toggle}
    class="text-xs text-muted px-3 py-1 rounded-full border border-border transition-all duration-150 hover:bg-bg3 hover:text-foreground font-mono"
    aria-label={m.settings_language()}
  >
    {locale.current.toUpperCase()}
  </button>
</header>
