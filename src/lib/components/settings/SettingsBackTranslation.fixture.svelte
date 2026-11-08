<script lang="ts">
  import { ParaglideJS } from '@inlang/paraglide-sveltekit';
  import { i18n } from '$lib/i18n';
  import SettingsLayerHeader from './SettingsLayerHeader.svelte';
  let { language }: { language: 'en' | 'es' } = $props();
</script>

<ParaglideJS {i18n} languageTag={language}>
  <SettingsLayerHeader />
</ParaglideJS>
