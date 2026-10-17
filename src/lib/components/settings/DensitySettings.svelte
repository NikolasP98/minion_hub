<script lang="ts">
  import { SegmentedControl } from '$lib/components/ui';
  import { density, type DensityMode } from '$lib/state/ui/density.svelte';
  import * as m from '$lib/paraglide/messages';
</script>

<section class="flex items-center justify-between gap-4 flex-wrap">
  <div class="space-y-1">
    <h2 class="text-xs font-semibold text-foreground uppercase tracking-wider">
      {m.settings_density()}
    </h2>
    <p class="text-xs text-muted-foreground">{m.settings_densityDescription()}</p>
  </div>
  <SegmentedControl
    size="md"
    aria-label={m.settings_density()}
    value={density.mode}
    items={[
      { value: 'compact', label: m.settings_densityCompact() },
      { value: 'comfortable', label: m.settings_densityComfortable() },
    ]}
    onValueChange={(v) => density.set(v as DensityMode)}
  />
</section>
