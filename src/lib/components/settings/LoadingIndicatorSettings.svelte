<script lang="ts">
  import { SegmentedControl } from '$lib/components/ui';
  import {
    loadingIndicator,
    type LoadingIndicatorPlacement,
  } from '$lib/state/ui/loading-indicator.svelte';
  import * as m from '$lib/paraglide/messages';
</script>

<section class="flex items-center justify-between gap-4 flex-wrap">
  <div class="space-y-1">
    <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider">
      {m.settings_loadingIndicator()}
    </h2>
    <p class="text-xs text-muted-foreground">{m.settings_loadingIndicatorDescription()}</p>
  </div>
  <SegmentedControl
    size="md"
    aria-label={m.settings_loadingIndicator()}
    value={loadingIndicator.placement}
    items={[
      { value: 'icon-ring', label: m.settings_loadingIndicatorIconRing() },
      { value: 'divider-bar', label: m.settings_loadingIndicatorDividerBar() },
    ]}
    onValueChange={(v) => loadingIndicator.set(v as LoadingIndicatorPlacement)}
  />
</section>
