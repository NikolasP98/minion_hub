<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { ParaglideJS } from '@inlang/paraglide-sveltekit';
  import { i18n } from '$lib/i18n';
  import ParticleCanvas from '$lib/components/layout/ParticleCanvas.svelte';
  import BgPattern from '$lib/components/decorations/BgPattern.svelte';
  import Toaster from '$lib/components/layout/Toaster.svelte';
  import HostsOverlay from '$lib/components/hosts/HostsOverlay.svelte';
  import { theme, applyTheme } from '$lib/state/ui/theme.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';
  import { loadHosts, hostsState } from '$lib/state/features/hosts.svelte';
  import { wsConnect } from '$lib/services/gateway.svelte';
  import { loadUser, userState } from '$lib/state/features/user.svelte';
  import { type Snippet } from 'svelte';
  import { locale } from '$lib/state/ui/locale.svelte';
  import { injectSpeedInsights } from '@vercel/speed-insights/sveltekit';
  import { inject as injectAnalytics } from '@vercel/analytics';

  injectSpeedInsights();
  injectAnalytics();

  let { children }: { children: Snippet } = $props();

  onMount(async () => {
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

    await loadHosts();
    if (hostsState.activeHostId) wsConnect();
  });

  $effect(() => {
    applyTheme(theme.preset, theme.accent.value);
  });
</script>

<ParaglideJS {i18n} languageTag={locale.current}>
  <ParticleCanvas />
  {#if page.url.pathname !== '/login'}
    <BgPattern />
  {/if}
  <Toaster />
  {@render children()}

  {#if ui.overlayOpen}
    <HostsOverlay />
  {/if}
</ParaglideJS>
