<script lang="ts">
  import { Handle, Position, useUpdateNodeInternals } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { RouterNodeData, RouterBranch, BranchConfig, FlowNodePreset } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes, openNodeContextMenu, presetsForNodeType } from '$lib/state/features/flow-editor.svelte';
  import { Split } from 'lucide-svelte';
  import { tick } from 'svelte';
  import BranchEditorField from './BranchEditorField.svelte';

  let { data, id }: NodeProps & { data: RouterNodeData } = $props();

  const updateNodeInternals = useUpdateNodeInternals();

  // Router stores routing config directly on `data`; adapt it to the shared
  // BranchConfig the editor field consumes.
  const value = $derived<BranchConfig>({ mode: data.mode, modelId: data.modelId, branches: data.branches });
  const routerPresets = $derived(presetsForNodeType('router'));

  function patch(partial: Partial<RouterNodeData>) {
    const next = flowEditorState.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...partial } } : n));
    setNodes(next);
  }

  async function handleChange(v: BranchConfig) {
    const prevCount = data.branches.length;
    patch({ mode: v.mode, modelId: v.modelId, branches: v.branches });
    // Re-register handles only when the branch count changed (handle added/removed).
    if (v.branches.length !== prevCount) {
      await tick();
      updateNodeInternals(id);
    }
  }

  // A fresh node can one-click apply a plugin-contributed preset (e.g.
  // alert-watcher's severity rubric). Presets vanish with their plugin.
  async function applyPreset(preset: FlowNodePreset) {
    const d = preset.data as Partial<RouterNodeData>;
    const { branches, ...rest } = d;
    patch(rest);
    if (Array.isArray(branches)) {
      patch({ branches: branches as RouterBranch[] });
      await tick();
      updateNodeInternals(id);
    }
  }
</script>

<Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-[var(--color-warning-border)] !bg-[var(--color-warning-surface)]" />

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-56 max-w-72 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-2">
    <div class="w-6 h-6 rounded-md bg-[var(--color-warning-surface)] flex items-center justify-center shrink-0">
      <Split size={12} class="text-[var(--color-warning-fg)]" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate">{data.label || 'Router'}</span>
  </div>

  <BranchEditorField {value} onChange={handleChange} presets={routerPresets} onApplyPreset={applyPreset}>
    {#snippet branchHandle(branchId)}
      <Handle type="source" position={Position.Right} id={branchId} style="top: 13px; right: -21px;" class="!w-3 !h-3 !border-2 !border-[var(--color-warning-border)] !bg-[var(--color-warning-surface)]" />
    {/snippet}
  </BranchEditorField>

  <div class="relative mt-2 pt-1.5 border-t border-border/50 text-[length:var(--font-size-telemetry)] text-muted">
    default
    <Handle type="source" position={Position.Right} id="default" class="!w-3 !h-3 !border-2 !border-[var(--color-border-default)] !bg-[var(--color-surface-2)]" />
  </div>
</div>
