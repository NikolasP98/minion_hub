<script lang="ts">
  import type { SectionMeta } from "@minion-stack/shared";
  import { promptSections } from "$lib/state/features/prompt-sections.svelte";
  import { getOverrides, listSections } from "$lib/services/prompt-sections-rpc";
  import { toastError } from "$lib/state/ui/toast.svelte";
  import { LAYER_ORDER } from "$lib/utils/layer-colors";
  import LayerGroup from "./LayerGroup.svelte";

  let loadToken = 0;

  $effect(() => {
    const agentId = promptSections.agentId;
    if (!agentId) return;
    const token = ++loadToken;
    promptSections.isLoading = true;
    (async () => {
      try {
        const [sections, overrides] = await Promise.all([
          listSections(agentId),
          getOverrides(agentId),
        ]);
        // Guard: ignore stale responses from a prior agentId.
        if (token !== loadToken) return;
        promptSections.sections = sections;
        promptSections.disabledOverrides = overrides.disabled;
      } catch (err) {
        if (token !== loadToken) return;
        toastError("Failed to load prompt sections", (err as Error).message);
      } finally {
        if (token === loadToken) promptSections.isLoading = false;
      }
    })();
  });

  const grouped = $derived.by(() => {
    const map = new Map<string, SectionMeta[]>();
    for (const s of promptSections.sections) {
      const key = s.layer.startsWith("custom") ? "custom" : s.layer;
      const list = map.get(key);
      if (list) list.push(s);
      else map.set(key, [s]);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    }
    // Ordered output: canonical layer order, then custom at the end.
    const out: Array<[string, SectionMeta[]]> = [];
    for (const layer of LAYER_ORDER) {
      const list = map.get(layer);
      if (list && list.length > 0) out.push([layer, list]);
    }
    const customList = map.get("custom");
    if (customList && customList.length > 0) out.push(["custom", customList]);
    return out;
  });
</script>

<div class="flex flex-col h-full">
  {#if promptSections.isLoading && promptSections.sections.length === 0}
    <div class="flex flex-col gap-2 p-3">
      {#each Array(6) as _, i (i)}
        <div class="h-8 rounded bg-bg2 animate-pulse"></div>
      {/each}
    </div>
  {:else if grouped.length === 0}
    <div class="p-4 text-xs text-muted">
      No sections for this agent yet. Create one via the editor or YAML files.
    </div>
  {:else}
    <div class="flex-1 overflow-y-auto">
      {#each grouped as [layer, sections] (layer)}
        <LayerGroup {layer} {sections} disabled={promptSections.disabledOverrides} />
      {/each}
    </div>
  {/if}
</div>
