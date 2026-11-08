<script lang="ts">
  import { ArrowLeft } from 'lucide-svelte';
  import { Button, Spinner, iconSizes } from '$lib/components/ui';
  import { settingsLayer } from '$lib/nav/settings-layer.svelte';
  import * as m from '$lib/paraglide/messages';
  let { busy = false }: { busy?: boolean } = $props();
</script>

<div class="settings-layer-header">
  <!-- The layer owns this complete localized URL, including its fallback. -->
  <Button
    variant="ghost"
    aria-label={m.common_back()}
    href={settingsLayer.returnHref()}
    data-no-translate
  >
    <span class="back-icon" class:busy aria-hidden="true">
      <ArrowLeft size={iconSizes.md} class="back-arrow" />
      <Spinner size="md" class="busy-ring" />
    </span>
    <span class="t-title">{m.settings_title()}</span>
  </Button>
</div>

<style>
  .settings-layer-header :global(a) {
    width: 100%;
    min-height: var(--control-height-touch);
    justify-content: flex-start;
  }
  .back-icon {
    display: grid;
    place-items: center;
  }
  .back-icon > :global(*) {
    grid-area: 1 / 1;
  }
  .back-icon :global(.busy-ring) {
    opacity: 0;
    color: var(--color-accent);
  }
  .back-icon.busy :global(.busy-ring) {
    opacity: 1;
  }
  .back-icon.busy :global(.back-arrow) {
    opacity: 0;
  }
</style>
