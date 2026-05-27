<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { StructuredNodeData } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes } from '$lib/state/features/flow-editor.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { Braces } from 'lucide-svelte';
  import { onMount } from 'svelte';

  let { data, id }: NodeProps & { data: StructuredNodeData } = $props();

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

  function patch(partial: Partial<StructuredNodeData>) {
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, ...partial } } : n,
    );
    setNodes(next);
  }
</script>

<Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-teal-400 !bg-teal-900" />
<Handle type="source" position={Position.Right} id="out" class="!w-3 !h-3 !border-2 !border-teal-400 !bg-teal-900" />

<div class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-64 shadow-lg select-none border-border hover:border-border/80">
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-teal-500/20 flex items-center justify-center shrink-0">
      <Braces size={12} class="text-teal-300" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate">{data.label || 'Structured'}</span>
  </div>
  <select
    class="w-full text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground mb-1"
    value={data.modelId}
    onclick={(e) => e.stopPropagation()}
    onchange={(e) => patch({ modelId: (e.target as HTMLSelectElement).value })}
  >
    {#each models as mdl (mdl.id)}
      <option value={mdl.id}>{mdl.name ?? mdl.id}</option>
    {/each}
  </select>
  <textarea
    class="w-full text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground resize-y min-h-12 font-mono"
    placeholder={'{ "type": "object", "properties": {} }'}
    value={data.schema}
    onclick={(e) => e.stopPropagation()}
    oninput={(e) => patch({ schema: (e.target as HTMLTextAreaElement).value })}
  ></textarea>
</div>
