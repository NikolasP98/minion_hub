<script lang="ts">
  import '../../app.css';
  import { ParaglideJS } from '@inlang/paraglide-sveltekit';
  import { i18n } from '$lib/i18n';
  import ParticleCanvas from '$lib/components/ParticleCanvas.svelte';
  import BgPattern from '$lib/components/decorations/BgPattern.svelte';
  import { theme, applyTheme } from '$lib/state/theme.svelte';
  import { locale } from '$lib/state/locale.svelte';
  import { type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
  $effect(() => applyTheme(theme.preset, theme.accent.value));
</script>

<ParaglideJS {i18n} languageTag={locale.current}>
  <ParticleCanvas />
  <BgPattern />
  {@render children()}
</ParaglideJS>
