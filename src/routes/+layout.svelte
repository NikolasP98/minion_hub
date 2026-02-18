<script lang="ts">
  import '../app.css';
  import ParticleCanvas from '$lib/components/ParticleCanvas.svelte';
  import ShutdownBanner from '$lib/components/ShutdownBanner.svelte';
  import { type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<ParticleCanvas />
<ShutdownBanner />
{@render children()}
