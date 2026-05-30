<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { goto, afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import { ParaglideJS } from '@inlang/paraglide-sveltekit';
  import { i18n } from '$lib/i18n';
  import ParticleCanvas from '$lib/components/layout/ParticleCanvas.svelte';
  import BgPattern from '$lib/components/decorations/BgPattern.svelte';
  import VoxelShader from '$lib/components/decorations/VoxelShader.svelte';
  import Toaster from '$lib/components/layout/Toaster.svelte';
  import BugReporter from '$lib/components/layout/BugReporter.svelte';
  import HostsOverlay from '$lib/components/hosts/HostsOverlay.svelte';
  import { theme, applyTheme } from '$lib/state/ui/theme.svelte';
  import { crtConfig } from '$lib/state/ui/crt-config.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { loadHosts, hostsState } from '$lib/state/features/hosts.svelte';
  import { wsConnect } from '$lib/services/gateway.svelte';
  import { userState } from '$lib/state/features/user.svelte';
  import { type Snippet } from 'svelte';
  import type { LayoutData } from './$types';
  import { locale } from '$lib/state/ui/locale.svelte';
  import { loadAndApplyServerPreferences } from '$lib/state/ui/preference-sync.svelte';
  import { installInterceptor } from '$lib/utils/console-interceptor';
  import { injectSpeedInsights } from '@vercel/speed-insights/sveltekit';
  import { inject as injectAnalytics } from '@vercel/analytics';

  // D-07: only call Vercel telemetry when NOT in desktop mode
  if (!import.meta.env.VITE_DESKTOP) {
    injectSpeedInsights();
    injectAnalytics();
  }

  // `data` (LayoutData) is consumed via `page.data` getters in userState; we
  // don't need it directly in this component.
  let { children }: { data: LayoutData; children: Snippet } = $props();

  const isVoxelized = $derived(theme.preset.id === 'voxelized');

  // userState now derives from `page.data` via getters — no rune hydration
  // needed. Server load + `invalidate('app:user')` is the single refresh path.

  // Manual PostHog pageview capture. We disabled the default history-patch
  // capture (`capture_pageview: false` in hooks.client.ts) to silence the
  // SvelteKit "Avoid using history.pushState(...)" router warning.
  if (!import.meta.env.VITE_DESKTOP) {
    afterNavigate(() => {
      const ph = (window as Window & { posthog?: { capture: (e: string, p?: Record<string, unknown>) => void } }).posthog;
      ph?.capture('$pageview');
    });
  }

  onMount(async () => {
    installInterceptor();

    if (!userState.user) {
      const current = page.url.pathname;
      const redirectParam =
        current !== '/' && current !== '/login'
          ? `?redirectTo=${encodeURIComponent(current)}`
          : '';
      goto(`/login${redirectParam}`, { replaceState: true });
      return;
    }

    await loadAndApplyServerPreferences();
    await loadHosts();
    if (hostsState.activeHostId) wsConnect();
  });

  $effect(() => {
    applyTheme(theme.preset, theme.accent.value);
  });

  $effect(() => {
    if (theme.preset.id === 'crt') {
      crtConfig.apply();
    } else {
      crtConfig.cleanup();
    }
  });
</script>

<ParaglideJS {i18n} languageTag={locale.current}>
  {#if isVoxelized && page.url.pathname !== '/login'}
    <VoxelShader />
  {/if}
  {#if !isVoxelized}
    <ParticleCanvas />
  {/if}
  {#if page.url.pathname !== '/login' && !isVoxelized}
    <BgPattern />
  {/if}
  <Toaster />
  <BugReporter />

  {#if conn.connecting}
    <div class="fixed top-0 left-0 right-0 h-[2px] bg-bg3 z-50 overflow-hidden">
      <div class="h-full w-1/3 bg-accent animate-loading-slide"></div>
    </div>
  {/if}

  {#key page.url.pathname.split('/')[1]}
    <div style="animation: page-fade-in 120ms ease-out">
      {@render children()}
    </div>
  {/key}

  {#if ui.overlayOpen}
    <HostsOverlay />
  {/if}
</ParaglideJS>
