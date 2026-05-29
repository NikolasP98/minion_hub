<script lang="ts">
  import { onMount } from 'svelte';
  import { loadHistory } from '$lib/state/features/studio.svelte';
  import PromptBuilder from '$lib/components/studio/PromptBuilder.svelte';
  import ImagePreview from '$lib/components/studio/ImagePreview.svelte';
  import GenerationHistory from '$lib/components/studio/GenerationHistory.svelte';
  import { Paintbrush } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { PageHeader } from '$lib/components/ui';

  onMount(() => {
    loadHistory();
  });
</script>

<div class="studio-page">
  <!-- Header -->
  <PageHeader title={m.studio_title()} subtitle={m.studio_subtitle()}>
    {#snippet leading()}
      <Paintbrush size={16} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

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
