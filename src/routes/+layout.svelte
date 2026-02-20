<script lang="ts">
  import '../app.css';
  import ParticleCanvas from '$lib/components/ParticleCanvas.svelte';
  import BgPattern from '$lib/components/decorations/BgPattern.svelte';
  import ShutdownBanner from '$lib/components/ShutdownBanner.svelte';
  import HostsOverlay from '$lib/components/HostsOverlay.svelte';
  import { theme, applyTheme } from '$lib/state/theme.svelte';
  import { ui } from '$lib/state/ui.svelte';
  import { type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

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
