<script lang="ts">
  import { Button, Select } from '$lib/components/ui';
import type { Snippet } from 'svelte';
  import type { BranchConfig, RouterBranch, RouterRuleOp, FlowNodePreset } from '$lib/state/features/flow-editor.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { Plus, X, Sparkles } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';

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
  <Button variant="ghost"
    class="flex-1 text-[length:var(--font-size-telemetry)] font-semibold rounded px-1 py-0.5 transition-colors {value.mode === 'rule' ? 'bg-[var(--color-warning-surface)] text-[var(--color-warning-fg)] border border-[var(--color-warning-border)]' : 'text-muted/60 border border-transparent'}"
    onclick={(e) => { e.stopPropagation(); setMode('rule'); }}
    title={m.flowcfg_ruleModeTip()}
  >{m.flowcfg_rule()}</Button>
  <Button variant="ghost"
    class="flex-1 text-[length:var(--font-size-telemetry)] font-semibold rounded px-1 py-0.5 transition-colors {value.mode === 'llm' ? 'bg-[var(--color-warning-surface)] text-[var(--color-warning-fg)] border border-[var(--color-warning-border)]' : 'text-muted/60 border border-transparent'}"
    onclick={(e) => { e.stopPropagation(); setMode('llm'); }}
    title={m.flowcfg_llmModeTip()}
  >{m.flowcfg_llm()}</Button>
  <Button variant="ghost"
    class="flex-1 text-[length:var(--font-size-telemetry)] font-semibold rounded px-1 py-0.5 transition-colors {value.mode === 'hybrid' ? 'bg-[var(--color-warning-surface)] text-[var(--color-warning-fg)] border border-[var(--color-warning-border)]' : 'text-muted/60 border border-transparent'}"
    onclick={(e) => { e.stopPropagation(); setMode('hybrid'); }}
    title={m.flowcfg_hybridModeTip()}
  >{m.flowcfg_hybrid()}</Button>
</div>

{#if value.mode === 'llm' || value.mode === 'hybrid'}
  <Select size="sm"
    class="text-[length:var(--font-size-telemetry)] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground"
    fieldClass="mb-2 w-full"
    value={value.modelId ?? ''}
    onclick={(e: MouseEvent) => e.stopPropagation()}
    onchange={(next) => setModel(String(next))}
  >
    {#each models as mdl (mdl.id)}
      <option value={mdl.id}>{mdl.name ?? mdl.id}</option>
    {/each}
  </Select>
{/if}

<div class="flex flex-col gap-1.5">
  {#each branches as branch (branch.id)}
    <!-- Each branch is its own relative block so a source handle (Router) aligns
         to the label row regardless of the description's height. -->
    <div class="relative rounded border border-border/40 bg-bg/30 p-1">
      <div class="flex items-center gap-1">
        <input
          class="flex-1 text-[length:var(--font-size-telemetry)] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground"
          value={branch.label}
          placeholder={m.flowcfg_branchLabelPlaceholder()}
          onclick={(e) => e.stopPropagation()}
          oninput={(e) => updateBranch(branch.id, { label: (e.target as HTMLInputElement).value })}
        />
        <Button variant="ghost" class="text-muted/60 hover:text-[var(--color-danger-fg)] shrink-0" onclick={(e) => { e.stopPropagation(); removeBranch(branch.id); }} title={m.flowcfg_removeBranch()} aria-label={m.flowcfg_removeBranch()}>
          <X size={11} />
        </Button>
      </div>
      {#if value.mode === 'rule' || value.mode === 'hybrid'}
        <div class="flex items-center gap-1 mt-1">
          <Select size="sm"
            class="text-[length:var(--font-size-telemetry)] bg-bg3 border border-border rounded px-0.5 py-0.5 text-foreground"
            value={branch.rule?.op ?? 'contains'}
            onclick={(e: MouseEvent) => e.stopPropagation()}
            onchange={(next) => updateRule(branch.id, { op: String(next) as RouterRuleOp })}
          >
            {#each OPS as op (op)}<option value={op}>{op}</option>{/each}
          </Select>
          <input
            class="flex-1 text-[length:var(--font-size-telemetry)] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground"
            value={branch.rule?.value ?? ''}
            placeholder={value.mode === 'hybrid' ? m.flowcfg_hybridRulePlaceholder() : m.flowcfg_ruleValue()}
            onclick={(e) => e.stopPropagation()}
            oninput={(e) => updateRule(branch.id, { value: (e.target as HTMLInputElement).value })}
          />
        </div>
      {/if}
      {#if value.mode === 'llm' || value.mode === 'hybrid'}
        <textarea
          class="mt-1 w-full text-[length:var(--font-size-telemetry)] bg-bg3 border border-border rounded px-1 py-0.5 text-muted/90 resize-none leading-snug"
          rows="2"
          placeholder={m.flowcfg_branchDescriptionPlaceholder()}
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
  <Button variant="ghost" class="flex items-center gap-1 text-[length:var(--font-size-telemetry)] text-[var(--color-warning-fg)]/80 hover:text-[var(--color-warning-fg)]" onclick={(e) => { e.stopPropagation(); addBranch(); }}>
    <Plus size={11} /> {m.flowcfg_addBranch()}
  </Button>
  {#if isFresh}
    {#each presets as p (p.pluginId + ':' + p.id)}
      <Button variant="ghost"
        class="flex items-center gap-1 text-[length:var(--font-size-telemetry)] text-[var(--color-danger-fg)] hover:text-[var(--color-danger-fg)]"
        onclick={(e) => { e.stopPropagation(); onApplyPreset?.(p); }}
        title={p.description ?? p.label}
      >
        <Sparkles size={11} /> {p.label}
      </Button>
    {/each}
  {/if}
</div>
