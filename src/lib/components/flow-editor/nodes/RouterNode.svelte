<script lang="ts">
  import { Handle, Position, useUpdateNodeInternals } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { RouterNodeData, RouterBranch, RouterRuleOp } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes } from '$lib/state/features/flow-editor.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { Split, Plus, X } from 'lucide-svelte';
  import { onMount, tick } from 'svelte';

  let { data, id }: NodeProps & { data: RouterNodeData } = $props();

  const updateNodeInternals = useUpdateNodeInternals();

  interface ModelItem { id: string; name: string }
  let models = $state<ModelItem[]>([]);
  const FALLBACK_MODELS: ModelItem[] = [
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  ];

  onMount(async () => {
    try {
      const res = (await sendRequest('models.list', {})) as { models?: ModelItem[] } | null;
      models = res?.models?.length ? res.models : FALLBACK_MODELS;
    } catch {
      models = FALLBACK_MODELS;
    }
  });

  function makeBranchId() {
    return `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  }
  function patch(partial: Partial<RouterNodeData>) {
    const next = flowEditorState.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...partial } } : n));
    setNodes(next);
  }
  async function setBranches(branches: RouterBranch[]) {
    patch({ branches });
    await tick();
    updateNodeInternals(id);
  }
  function addBranch() {
    setBranches([...data.branches, { id: makeBranchId(), label: `Branch ${data.branches.length + 1}`, rule: { op: 'contains', value: '' } }]);
  }
  function removeBranch(branchId: string) {
    setBranches(data.branches.filter((b) => b.id !== branchId));
  }
  function updateBranch(branchId: string, partial: Partial<RouterBranch>) {
    patch({ branches: data.branches.map((b) => (b.id === branchId ? { ...b, ...partial } : b)) });
  }
  function updateRule(branchId: string, partial: Partial<{ op: RouterRuleOp; value: string }>) {
    const b = data.branches.find((x) => x.id === branchId);
    const rule = { op: b?.rule?.op ?? 'contains', value: b?.rule?.value ?? '', ...partial };
    updateBranch(branchId, { rule });
  }
  const OPS: RouterRuleOp[] = ['contains', 'equals', 'regex'];
</script>

<Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-amber-400 !bg-amber-900" />

<div class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-56 max-w-72 shadow-lg select-none border-border hover:border-border/80">
  <div class="flex items-center gap-2 mb-2">
    <div class="w-6 h-6 rounded-md bg-amber-500/20 flex items-center justify-center shrink-0">
      <Split size={12} class="text-amber-400" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate">{data.label || 'Router'}</span>
  </div>

  <div class="flex gap-1 mb-2">
    <button
      class="flex-1 text-[9px] font-semibold rounded px-1 py-0.5 transition-colors {data.mode === 'rule' ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40' : 'text-muted/60 border border-transparent'}"
      onclick={(e) => { e.stopPropagation(); patch({ mode: 'rule' }); }}
    >Rule</button>
    <button
      class="flex-1 text-[9px] font-semibold rounded px-1 py-0.5 transition-colors {data.mode === 'llm' ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40' : 'text-muted/60 border border-transparent'}"
      onclick={(e) => { e.stopPropagation(); patch({ mode: 'llm' }); }}
    >LLM</button>
  </div>

  {#if data.mode === 'llm'}
    <select
      class="w-full text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground mb-2"
      value={data.modelId ?? ''}
      onclick={(e) => e.stopPropagation()}
      onchange={(e) => patch({ modelId: (e.target as HTMLSelectElement).value })}
    >
      {#each models as mdl (mdl.id)}
        <option value={mdl.id}>{mdl.name ?? mdl.id}</option>
      {/each}
    </select>
  {/if}

  <div class="flex flex-col gap-1.5">
    {#each data.branches as branch, i (branch.id)}
      <div class="relative flex items-center gap-1">
        <input
          class="flex-1 text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground"
          value={branch.label}
          placeholder="label"
          onclick={(e) => e.stopPropagation()}
          oninput={(e) => updateBranch(branch.id, { label: (e.target as HTMLInputElement).value })}
        />
        {#if data.mode === 'rule'}
          <select
            class="text-[9px] bg-bg3 border border-border rounded px-0.5 py-0.5 text-foreground"
            value={branch.rule?.op ?? 'contains'}
            onclick={(e) => e.stopPropagation()}
            onchange={(e) => updateRule(branch.id, { op: (e.target as HTMLSelectElement).value as RouterRuleOp })}
          >
            {#each OPS as op (op)}<option value={op}>{op}</option>{/each}
          </select>
          <input
            class="w-14 text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground"
            value={branch.rule?.value ?? ''}
            placeholder="value"
            onclick={(e) => e.stopPropagation()}
            oninput={(e) => updateRule(branch.id, { value: (e.target as HTMLInputElement).value })}
          />
        {/if}
        <button class="text-muted/60 hover:text-red-400" onclick={(e) => { e.stopPropagation(); removeBranch(branch.id); }} title="Remove branch" aria-label="Remove branch">
          <X size={11} />
        </button>
        <Handle type="source" position={Position.Right} id={branch.id} style="top: {30 + i * 24}px" class="!w-3 !h-3 !border-2 !border-amber-400 !bg-amber-900" />
      </div>
    {/each}
  </div>

  <button class="mt-1.5 flex items-center gap-1 text-[10px] text-amber-400/80 hover:text-amber-300" onclick={(e) => { e.stopPropagation(); addBranch(); }}>
    <Plus size={11} /> Add branch
  </button>

  <div class="relative mt-2 pt-1.5 border-t border-border/50 text-[10px] text-muted">
    default
    <Handle type="source" position={Position.Right} id="default" class="!w-3 !h-3 !border-2 !border-slate-400 !bg-slate-900" />
  </div>
</div>
