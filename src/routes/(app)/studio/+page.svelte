<script lang="ts">
  import { onMount } from 'svelte';
  import { loadHistory } from '$lib/state/features/studio.svelte';
  import PromptBuilder from '$lib/components/studio/PromptBuilder.svelte';
  import ImagePreview from '$lib/components/studio/ImagePreview.svelte';
  import GenerationHistory from '$lib/components/studio/GenerationHistory.svelte';
  import { Paintbrush } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  onMount(() => {
    loadHistory();
  });
</script>

<div class="studio-page">
  <!-- Header -->
  <header class="studio-header">
    <div class="flex items-center gap-3">
      <div class="header-icon">
        <Paintbrush size={20} />
      </div>
      <div>
        <h1 class="text-base font-bold text-foreground">{m.studio_title()}</h1>
        <p class="text-xs text-muted">{m.studio_subtitle()}</p>
      </div>
    </div>
  </header>

  <!-- Main content -->
  <div class="studio-content">
    <div class="builder-panel">
      <PromptBuilder />
    </div>
    <div class="preview-panel">
      <ImagePreview />
    </div>
  </div>

  <!-- History strip -->
  <GenerationHistory />
</div>

<style>
  .studio-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  .studio-header {
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-border);
    background: color-mix(in srgb, var(--color-bg2) 80%, transparent);
    backdrop-filter: blur(8px);
    flex-shrink: 0;
  }

  .header-icon {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--color-brand-pink) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-brand-pink) 25%, transparent);
    border-radius: 8px;
    color: var(--color-brand-pink);
  }

  .studio-content {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(300px, 380px) 1fr;
    overflow: hidden;
  }

  .builder-panel {
    border-right: 1px solid var(--color-border);
    overflow: hidden;
  }

  .preview-panel {
    overflow-y: auto;
    padding: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  @media (max-width: 1024px) {
    .studio-content {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
    }

    .builder-panel {
      border-right: none;
      border-bottom: 1px solid var(--color-border);
      max-height: 50vh;
      overflow-y: auto;
    }
  }
</style>
