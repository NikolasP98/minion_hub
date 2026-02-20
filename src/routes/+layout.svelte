<script lang="ts">
  import '../app.css';
  import ParticleCanvas from '$lib/components/ParticleCanvas.svelte';
  import ShutdownBanner from '$lib/components/ShutdownBanner.svelte';
  import { theme, applyTheme } from '$lib/state/theme.svelte';
  import { type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();

  $effect(() => {
    applyTheme(theme.preset, theme.accent.value);
  });
</script>

<ParticleCanvas />
<ShutdownBanner />
{@render children()}
