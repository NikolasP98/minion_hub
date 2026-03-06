<script lang="ts">
  import '../../app.css';
  import { ParaglideJS } from '@inlang/paraglide-sveltekit';
  import { i18n } from '$lib/i18n';
  import ParticleCanvas from '$lib/components/layout/ParticleCanvas.svelte';
  import LoginShader from '$lib/components/decorations/LoginShader.svelte';
  import { theme, applyTheme } from '$lib/state/ui/theme.svelte';
  import { locale } from '$lib/state/ui/locale.svelte';
  import { type Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
  $effect(() => applyTheme(theme.preset, theme.accent.value));
</script>

<ParaglideJS {i18n} languageTag={locale.current}>
  <ParticleCanvas />
  <LoginShader />
  {@render children()}
</ParaglideJS>
