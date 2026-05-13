<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
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
  import { hydrateUser, loadUser, userState } from '$lib/state/features/user.svelte';
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

  let { data, children }: { data: LayoutData; children: Snippet } = $props();

  const isVoxelized = $derived(theme.preset.id === 'voxelized');

  // Reflow LayoutServerLoad data into the rune state on every load (initial +
  // every `invalidate('app:user')` triggered re-run). This keeps `isAdmin.value`
  // and all userState consumers in sync without forcing a hard refresh.
  $effect(() => {
    hydrateUser(data.user ?? null);
  });

  onMount(async () => {
    installInterceptor();
    // `hydrateUser` above already set user state from server data. Keep
    // `loadUser()` for the side effects it does (auth client session check,
    // org auto-activation, allowedAgentIds). Will be a no-op for state fields
    // already hydrated.
    await loadUser();

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
    <div class="fixed top-14 left-0 right-0 h-[2px] bg-bg3 z-40 overflow-hidden">
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
