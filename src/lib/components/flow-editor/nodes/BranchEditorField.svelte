<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { BranchConfig, RouterBranch, RouterRuleOp, FlowNodePreset } from '$lib/state/features/flow-editor.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { Plus, X, Sparkles } from 'lucide-svelte';
  import { onMount } from 'svelte';

  // Shared branch editor — drives the built-in Router node AND the
  // `type: 'branch-editor'` plugin config field. The parent owns the value and
  // (for the Router) re-registers handles after a branch count change.
  let {
    value,
    onChange,
    presets = [],
    onApplyPreset,
    branchHandle,
  }: {
    value: BranchConfig;
    onChange: (v: BranchConfig) => void | Promise<void>;
    presets?: FlowNodePreset[];
    onApplyPreset?: (p: FlowNodePreset) => void;
    /** Rendered inside each branch row (the Router passes a source <Handle>). */
    branchHandle?: Snippet<[string]>;
  } = $props();

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

  const branches = $derived(Array.isArray(value.branches) ? value.branches : []);
  const OPS: RouterRuleOp[] = ['contains', 'equals', 'regex'];

  function makeBranchId() {
    return `b-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  }
  function setMode(mode: BranchConfig['mode']) {
    onChange({ ...value, mode });
  }
  function setModel(modelId: string) {
    onChange({ ...value, modelId });
  }
  function addBranch() {
    const base = { id: makeBranchId(), label: `branch-${branches.length + 1}` };
    const branch: RouterBranch =
      value.mode === 'llm'
        ? { ...base, description: '' }
        : value.mode === 'hybrid'
          ? { ...base, description: '', rule: { op: 'contains' as RouterRuleOp, value: '' } }
          : { ...base, rule: { op: 'contains' as RouterRuleOp, value: '' } };
    onChange({ ...value, branches: [...branches, branch] });
  }
  function removeBranch(branchId: string) {
    onChange({ ...value, branches: branches.filter((b) => b.id !== branchId) });
  }
  function updateBranch(branchId: string, partial: Partial<RouterBranch>) {
    onChange({ ...value, branches: branches.map((b) => (b.id === branchId ? { ...b, ...partial } : b)) });
  }
  function updateRule(branchId: string, partial: Partial<{ op: RouterRuleOp; value: string }>) {
    const b = branches.find((x) => x.id === branchId);
    const rule = { op: b?.rule?.op ?? 'contains', value: b?.rule?.value ?? '', ...partial };
    updateBranch(branchId, { rule });
  }

  // A fresh editor (no meaningful branches yet) can one-click apply a plugin preset.
  const isFresh = $derived(
    branches.length <= 1 && !branches[0]?.description?.trim() && !branches[0]?.rule?.value?.trim(),
  );
</script>

<div class="flex gap-1 mb-2">
  <button
    class="flex-1 text-[9px] font-semibold rounded px-1 py-0.5 transition-colors {value.mode === 'rule' ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40' : 'text-muted/60 border border-transparent'}"
    onclick={(e) => { e.stopPropagation(); setMode('rule'); }}
    title="Match by text rule (contains / equals / regex)"
  >Rule</button>
  <button
    class="flex-1 text-[9px] font-semibold rounded px-1 py-0.5 transition-colors {value.mode === 'llm' ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40' : 'text-muted/60 border border-transparent'}"
    onclick={(e) => { e.stopPropagation(); setMode('llm'); }}
    title="Classify by LLM using each branch's rubric"
  >LLM</button>
  <button
    class="flex-1 text-[9px] font-semibold rounded px-1 py-0.5 transition-colors {value.mode === 'hybrid' ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40' : 'text-muted/60 border border-transparent'}"
    onclick={(e) => { e.stopPropagation(); setMode('hybrid'); }}
    title="Rule fast-path first, then LLM rubric fallback"
  >Hybrid</button>
</div>

{#if value.mode === 'llm' || value.mode === 'hybrid'}
  <select
    class="w-full text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground mb-2"
    value={value.modelId ?? ''}
    onclick={(e) => e.stopPropagation()}
    onchange={(e) => setModel((e.target as HTMLSelectElement).value)}
  >
    {#each models as mdl (mdl.id)}
      <option value={mdl.id}>{mdl.name ?? mdl.id}</option>
    {/each}
  </select>
{/if}

<div class="flex flex-col gap-1.5">
  {#each branches as branch (branch.id)}
    <!-- Each branch is its own relative block so a source handle (Router) aligns
         to the label row regardless of the description's height. -->
    <div class="relative rounded border border-border/40 bg-bg/30 p-1">
      <div class="flex items-center gap-1">
        <input
          class="flex-1 text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground"
          value={branch.label}
          placeholder="label (the value the LLM outputs)"
          onclick={(e) => e.stopPropagation()}
          oninput={(e) => updateBranch(branch.id, { label: (e.target as HTMLInputElement).value })}
        />
        <button class="text-muted/60 hover:text-red-400 shrink-0" onclick={(e) => { e.stopPropagation(); removeBranch(branch.id); }} title="Remove branch" aria-label="Remove branch">
          <X size={11} />
        </button>
      </div>
      {#if value.mode === 'rule' || value.mode === 'hybrid'}
        <div class="flex items-center gap-1 mt-1">
          <select
            class="text-[9px] bg-bg3 border border-border rounded px-0.5 py-0.5 text-foreground"
            value={branch.rule?.op ?? 'contains'}
            onclick={(e) => e.stopPropagation()}
            onchange={(e) => updateRule(branch.id, { op: (e.target as HTMLSelectElement).value as RouterRuleOp })}
          >
            {#each OPS as op (op)}<option value={op}>{op}</option>{/each}
          </select>
          <input
            class="flex-1 text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground"
            value={branch.rule?.value ?? ''}
            placeholder={value.mode === 'hybrid' ? 'rule (optional fast-path)' : 'value'}
            onclick={(e) => e.stopPropagation()}
            oninput={(e) => updateRule(branch.id, { value: (e.target as HTMLInputElement).value })}
          />
        </div>
      {/if}
      {#if value.mode === 'llm' || value.mode === 'hybrid'}
        <textarea
          class="mt-1 w-full text-[9px] bg-bg3 border border-border rounded px-1 py-0.5 text-muted/90 resize-none leading-snug"
          rows="2"
          placeholder="when to choose this branch (rubric / conditions)"
          value={branch.description ?? ''}
          onclick={(e) => e.stopPropagation()}
          oninput={(e) => updateBranch(branch.id, { description: (e.target as HTMLTextAreaElement).value })}
        ></textarea>
      {/if}
      {@render branchHandle?.(branch.id)}
    </div>
  {/each}
</div>

<div class="mt-1.5 flex items-center gap-2.5 flex-wrap">
  <button class="flex items-center gap-1 text-[10px] text-amber-400/80 hover:text-amber-300" onclick={(e) => { e.stopPropagation(); addBranch(); }}>
    <Plus size={11} /> Add branch
  </button>
  {#if isFresh}
    {#each presets as p (p.pluginId + ':' + p.id)}
      <button
        class="flex items-center gap-1 text-[10px] text-rose-300/80 hover:text-rose-200"
        onclick={(e) => { e.stopPropagation(); onApplyPreset?.(p); }}
        title={p.description ?? p.label}
      >
        <Sparkles size={11} /> {p.label}
      </button>
    {/each}
  {/if}
</div>
