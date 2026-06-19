<script lang="ts">
  import { Plus } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Popover } from '$lib/components/ui';
  import { resolvePluginIcon } from '$lib/plugins/icon-map';
  import type { ArtifactDescriptor } from '$lib/agents/artifacts';

  let {
    artifacts,
    canAdd = false,
    onopen,
  }: {
    artifacts: ArtifactDescriptor[];
    canAdd?: boolean;
    onopen: (a: ArtifactDescriptor) => void;
  } = $props();
</script>

<div class="border-t border-white/10 pt-3">
  <p class="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-white/35">{m.artifacts_label()}</p>
  <div class="flex flex-wrap items-center gap-2">
    {#each artifacts as a (a.id)}
      {@const Icon = resolvePluginIcon(a.icon)}
      <Popover placement="top">
        {#snippet trigger()}
          <button
            type="button"
            onclick={() => onopen(a)}
            aria-label={a.title}
            class="grid size-11 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-white/70 transition-colors hover:border-white/25 hover:bg-white/10 hover:text-white"
          >
            {#if typeof Icon !== 'string'}<Icon size={18} />{/if}
          </button>
        {/snippet}
          <div class="max-w-56 p-1">
            <p class="text-xs font-semibold text-white">{a.title}</p>
            <p class="mt-0.5 text-[11px] leading-snug text-white/60">{a.description}</p>
            <p class="mt-1 text-[10px] uppercase tracking-wide text-white/35">{m.artifact_kind_static()}</p>
          </div>
      </Popover>
    {/each}

    {#if canAdd}
      <Popover placement="top">
        {#snippet trigger()}
          <button
            type="button"
            aria-label={m.artifact_add()}
            class="grid size-11 place-items-center rounded-lg border border-dashed border-white/20 text-white/40 transition-colors hover:border-white/40 hover:text-white/70"
          >
            <Plus size={18} />
          </button>
        {/snippet}
          <p class="max-w-56 p-1 text-[11px] leading-snug text-white/60">{m.artifact_add_soon()}</p>
      </Popover>
      <!-- TODO: wire "+" to the artifact-builder system agent (#5, admin-only) -->
    {/if}
  </div>
</div>
