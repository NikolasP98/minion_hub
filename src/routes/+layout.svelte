<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import ParticleCanvas from '$lib/components/ParticleCanvas.svelte';
  import BgPattern from '$lib/components/decorations/BgPattern.svelte';
  import ShutdownBanner from '$lib/components/ShutdownBanner.svelte';
  import HostsOverlay from '$lib/components/HostsOverlay.svelte';
  import { theme, applyTheme } from '$lib/state/theme.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { loadHosts, hostsState } from '$lib/state/hosts.svelte';
  import { wsConnect } from '$lib/services/gateway.svelte';
  import { type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  onMount(async () => {
    await loadHosts();
    if (hostsState.activeHostId) wsConnect();
  });

  $effect(() => {
    applyTheme(theme.preset, theme.accent.value);
  });
</script>

<ParticleCanvas />
<BgPattern />
<ShutdownBanner />
{@render children()}

{#if ui.overlayOpen}
  <HostsOverlay />
{/if}
