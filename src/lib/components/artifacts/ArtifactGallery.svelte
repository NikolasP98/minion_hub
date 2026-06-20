<script lang="ts">
  import { Plus, Trash2, RefreshCw, History } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { Popover } from '$lib/components/ui';
  import { resolvePluginIcon } from '$lib/plugins/icon-map';
  import type { ArtifactDescriptor } from '$lib/agents/artifacts';

  let {
    artifacts,
    canAdd = false,
    onopen,
    oncreate,
    ondelete,
    onregenerate,
    onhistory,
  }: {
    artifacts: ArtifactDescriptor[];
    canAdd?: boolean;
    onopen: (a: ArtifactDescriptor) => void;
    oncreate?: () => void;
    ondelete?: (a: ArtifactDescriptor) => void;
    onregenerate?: (a: ArtifactDescriptor) => void;
    onhistory?: (a: ArtifactDescriptor) => void;
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
            {#if a.deletable && canAdd}
              <div class="mt-1.5 flex flex-col gap-0.5">
                <button
                  type="button"
                  onclick={() => onregenerate?.(a)}
                  class="flex items-center gap-1 text-[11px] text-white/60 hover:text-white transition-colors"
                >
                  <RefreshCw size={11} />
                  {m.artifact_regenerate()}
                </button>
                <button
                  type="button"
                  onclick={() => onhistory?.(a)}
                  class="flex items-center gap-1 text-[11px] text-white/60 hover:text-white transition-colors"
                >
                  <History size={11} />
                  {m.artifact_history()}
                </button>
                <button
                  type="button"
                  onclick={() => ondelete?.(a)}
                  class="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300 transition-colors"
                >
                  <Trash2 size={11} />
                  {m.artifact_delete()}
                </button>
              </div>
            {/if}
          </div>
      </Popover>
    {/each}

    {#if canAdd}
      <button
        type="button"
        aria-label={m.artifact_add()}
        onclick={() => oncreate?.()}
        class="grid size-11 place-items-center rounded-lg border border-dashed border-white/20 text-white/40 transition-colors hover:border-white/40 hover:text-white/70"
      >
        <Plus size={18} />
      </button>
    {/if}
  </div>
</div>
