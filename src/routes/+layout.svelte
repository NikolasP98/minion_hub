<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { ParaglideJS } from '@inlang/paraglide-sveltekit';
  import { i18n } from '$lib/i18n';
  import ParticleCanvas from '$lib/components/ParticleCanvas.svelte';
  import BgPattern from '$lib/components/decorations/BgPattern.svelte';
  import ShutdownBanner from '$lib/components/ShutdownBanner.svelte';
  import HostsOverlay from '$lib/components/HostsOverlay.svelte';
  import { theme, applyTheme } from '$lib/state/theme.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { loadHosts, hostsState } from '$lib/state/hosts.svelte';
  import { wsConnect } from '$lib/services/gateway.svelte';
  import { loadUser } from '$lib/state/user.svelte';
  import { type Snippet } from 'svelte';
  import { locale } from '$lib/state/locale.svelte';

  let { children }: { children: Snippet } = $props();

  onMount(async () => {
    await loadHosts();
    if (hostsState.activeHostId) wsConnect();
    loadUser(); // fire-and-forget
  });

  $effect(() => {
    applyTheme(theme.preset, theme.accent.value);
  });
</script>

<ParaglideJS {i18n} languageTag={locale.current}>
  <ParticleCanvas />
  <BgPattern />
  <ShutdownBanner />
  {@render children()}

  {#if ui.overlayOpen}
    <HostsOverlay />
  {/if}
</ParaglideJS>
