<script lang="ts">
  import type { FlowNode, AgentNodeData } from '$lib/state/flow-editor.svelte';
  import { flowEditorState, setNodes } from '$lib/state/flow-editor.svelte';
  import { X, Plus, Trash2 } from 'lucide-svelte';

  let { nodeId, onclose }: { nodeId: string; onclose: () => void } = $props();

  const node = $derived(flowEditorState.nodes.find((n) => n.id === nodeId) as FlowNode | undefined);
  const nodeData = $derived(node?.data as AgentNodeData | undefined);

  function updateLabel(value: string) {
    if (!node) return;
    setNodes(
      flowEditorState.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, label: value } } : n,
      ),
    );
  }

  function updateDefaultValue(key: string, value: string) {
    if (!nodeData) return;
    setNodes(
      flowEditorState.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, defaultValues: { ...nodeData.defaultValues, [key]: value } } }
          : n,
      ),
    );
  }

  function addDefaultValue() {
    if (!nodeData) return;
    const key = `param${Object.keys(nodeData.defaultValues ?? {}).length + 1}`;
    updateDefaultValue(key, '');
  }

  function removeDefaultValue(key: string) {
    if (!nodeData) return;
    const next = { ...nodeData.defaultValues };
    delete next[key];
    setNodes(
      flowEditorState.nodes.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, defaultValues: next } } : n,
      ),
    );
  }
</script>

{#if node && nodeData}
  <div class="bg-bg2 border border-border rounded-xl shadow-xl w-72 overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between px-4 py-3 border-b border-border">
      <span class="text-sm font-semibold text-foreground">Node Settings</span>
      <button
        onclick={onclose}
        class="w-6 h-6 rounded flex items-center justify-center text-muted hover:text-foreground hover:bg-bg3 transition-colors"
      >
        <X size={14} />
      </button>
    </div>

    <div class="p-4 space-y-4">
      <!-- Label -->
      <div>
        <label for="node-label" class="text-xs font-medium text-muted block mb-1">Label</label>
        <input
          id="node-label"
          type="text"
          class="w-full text-sm bg-bg3 border border-border rounded-lg px-3 py-1.5 text-foreground focus:outline-none focus:border-accent/60"
          value={nodeData.label}
          oninput={(e) => updateLabel((e.target as HTMLInputElement).value)}
        />
      </div>

      <!-- Default Values -->
      <div>
        <div class="flex items-center justify-between mb-2">
          <span class="text-xs font-medium text-muted">Default Values</span>
          <button
            onclick={addDefaultValue}
            class="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors"
          >
            <Plus size={12} />
            Add
          </button>
        </div>

        {#each Object.entries(nodeData.defaultValues ?? {}) as [key, value] (key)}
          <div class="flex items-center gap-2 mb-2">
            <input
              type="text"
              class="w-24 text-xs bg-bg3 border border-border rounded px-2 py-1 text-muted font-mono"
              value={key}
              readonly
            />
            <input
              type="text"
              class="flex-1 text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
              value={value}
              oninput={(e) => updateDefaultValue(key, (e.target as HTMLInputElement).value)}
            />
            <button
              onclick={() => removeDefaultValue(key)}
              class="text-muted hover:text-red-400 transition-colors shrink-0"
            >
              <Trash2 size={12} />
            </button>
          </div>
        {/each}

        {#if Object.keys(nodeData.defaultValues ?? {}).length === 0}
          <p class="text-xs text-muted/50 italic">No default values configured</p>
        {/if}
      </div>

      <!-- Context Rules -->
      <div>
        <p class="text-xs font-medium text-muted block mb-1">Context Rules</p>
        {#each nodeData.contextRules ?? [] as rule (rule.contextNodeId + rule.condition)}
          <div class="text-xs bg-bg3 border border-border rounded px-2 py-1.5 mb-1.5">
            <span class="text-muted">if </span>
            <span class="text-foreground font-mono">{rule.condition}</span>
            <span class="text-muted"> → inject </span>
            <span class="text-accent font-mono">{rule.contextNodeId}</span>
          </div>
        {/each}
        {#if !nodeData.contextRules?.length}
          <p class="text-xs text-muted/50 italic">No context rules configured</p>
        {/if}
      </div>
    </div>
  </div>
{/if}
