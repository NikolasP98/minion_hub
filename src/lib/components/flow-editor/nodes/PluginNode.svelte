<script lang="ts">
  import { Button } from '$lib/components/ui';
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { PluginTriggerNodeData, PluginActionNodeData } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes, openNodeContextMenu, openNodeConfig, descriptorForNode, branchFieldFor } from '$lib/state/features/flow-editor.svelte';
  import { Puzzle, Settings2, Split } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let { data, id }: NodeProps & { data: PluginTriggerNodeData | PluginActionNodeData } = $props();

  const updateNodeInternals = useUpdateNodeInternals();

  const isTrigger = $derived('event' in data);
  const node = $derived(flowEditorState.nodes.find((n) => n.id === id));
  const configurable = $derived((descriptorForNode(node)?.config?.length ?? 0) > 0);
  // A `branch-editor` config field turns this action node into a brancher: its
  // branches surface as source handles so the user can wire each outcome.
  const branch = $derived(isTrigger ? null : branchFieldFor(node));
  const branches = $derived(branch?.value.branches ?? []);

  // Branches are edited in the detached config panel, so this node re-registers
  // its handles whenever the branch count changes (xyflow caches handle bounds).
  $effect(() => {
    branches.length;
    updateNodeInternals(id);
  });

  function handleDeliverChange(e: Event) {
    const deliverResponse = (e.target as HTMLInputElement).checked;
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, deliverResponse } } : n,
    );
    setNodes(next);
  }
</script>

{#if !isTrigger}
  <Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-[color-mix(in_srgb,var(--color-purple)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)]" />
{/if}
{#if !branch}
  <!-- Single passthrough output. A brancher renders per-branch handles below. -->
  <Handle type="source" position={Position.Right} id="out" class="!w-3 !h-3 !border-2 !border-[color-mix(in_srgb,var(--color-purple)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)]" />
{/if}

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-60 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  ondblclick={() => configurable && openNodeConfig(id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)] flex items-center justify-center shrink-0">
      <Puzzle size={12} class="text-[var(--color-purple)]" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate flex-1">{data.label}</span>
    {#if configurable}
      <Button variant="ghost"
        class="shrink-0 text-muted/60 hover:text-foreground transition-colors"
        title={m.common_configure()}
        aria-label={m.flownode_configureNode()}
        onclick={(e) => { e.stopPropagation(); openNodeConfig(id); }}
      >
        <Settings2 size={12} />
      </Button>
    {/if}
  </div>
  <div class="text-[length:var(--font-size-telemetry)] text-muted/70 mb-1">
    {data.pluginId} · {isTrigger ? (data as PluginTriggerNodeData).event : (data as PluginActionNodeData).method}
  </div>

  {#if isTrigger}
    <label class="flex items-center gap-1.5 cursor-pointer">
      <input
        type="checkbox"
        class="w-3 h-3 accent-violet-400"
        checked={(data as PluginTriggerNodeData).deliverResponse}
        onclick={(e) => e.stopPropagation()}
        onchange={handleDeliverChange}
      />
      <span class="text-[length:var(--font-size-telemetry)] text-muted">{m.flownode_replyToChannel()}</span>
    </label>
  {/if}

  {#if branch}
    <!-- Branch outputs: edit the rules in the config panel; wire them here. -->
    <div class="mt-1.5 flex items-center gap-1 text-[length:var(--font-size-telemetry)] text-[var(--color-warning-fg)]/80">
      <Split size={10} /> {m.flownode_routesOnOutput()}
    </div>
    <div class="flex flex-col gap-1 mt-1">
      {#each branches as b (b.id)}
        <div class="relative rounded border border-border/40 bg-bg/30 px-1.5 py-0.5 text-[length:var(--font-size-telemetry)] text-foreground truncate">
          {b.label || b.id}
          <Handle type="source" position={Position.Right} id={b.id} style="top: 50%; right: -21px;" class="!w-3 !h-3 !border-2 !border-[var(--color-warning-border)] !bg-[var(--color-warning-surface)]" />
        </div>
      {/each}
      {#if branches.length === 0}
        <p class="text-[length:var(--font-size-telemetry)] text-muted/70">{m.flownode_noBranchesYetAddInConfigure()}</p>
      {/if}
      <div class="relative pt-1 mt-0.5 border-t border-border/50 text-[length:var(--font-size-telemetry)] text-muted">
        {m.flownode_default()}
        <Handle type="source" position={Position.Right} id="default" style="top: 50%; right: -21px;" class="!w-3 !h-3 !border-2 !border-[var(--color-border-default)] !bg-[var(--color-surface-2)]" />
      </div>
    </div>
  {/if}
</div>
