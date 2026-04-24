<script lang="ts">
  import type { SectionMeta } from "@minion-stack/shared";
  import { colorForLayer, layerLabel } from "$lib/utils/layer-colors";
  import SectionRow from "./SectionRow.svelte";

  let {
    layer,
    sections,
    disabled,
  }: {
    layer: string;
    sections: SectionMeta[];
    disabled: string[];
  } = $props();

  const color = $derived(colorForLayer(layer));
</script>

<div class="flex flex-col">
  <div
    class="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-bg border-b border-border"
  >
    <span class="w-2 h-2 rounded-full {color.dot}"></span>
    <span class="text-xs font-semibold uppercase tracking-wide text-muted">
      {layerLabel(layer)}
    </span>
    <span class="text-[10px] text-muted font-mono ml-auto">{sections.length}</span>
  </div>
  <div class="flex flex-col">
    {#each sections as section (section.id)}
      <SectionRow {section} isDisabled={disabled.includes(section.id)} />
    {/each}
  </div>
</div>
