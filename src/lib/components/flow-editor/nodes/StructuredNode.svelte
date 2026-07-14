<script lang="ts">
  import { Select } from '$lib/components/ui';
import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { StructuredNodeData } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes, openNodeContextMenu } from '$lib/state/features/flow-editor.svelte';
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

<Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-[color-mix(in_srgb,var(--color-cyan)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-cyan)_20%,transparent)]" />
<Handle type="source" position={Position.Right} id="out" class="!w-3 !h-3 !border-2 !border-[color-mix(in_srgb,var(--color-cyan)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-cyan)_20%,transparent)]" />

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-64 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-[color-mix(in_srgb,var(--color-cyan)_20%,transparent)] flex items-center justify-center shrink-0">
      <Braces size={12} class="text-[var(--color-cyan)]" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate">{data.label || 'Structured'}</span>
  </div>
  <Select size="sm"
    class="w-full text-[length:var(--font-size-telemetry)] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground mb-1"
    value={data.modelId}
    onclick={(e: MouseEvent) => e.stopPropagation()}
    onchange={(next) => patch({ modelId: String(next) })}
  >
    {#each models as mdl (mdl.id)}
      <option value={mdl.id}>{mdl.name ?? mdl.id}</option>
    {/each}
  </Select>
  <textarea
    class="w-full text-[length:var(--font-size-telemetry)] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground resize-y min-h-12 font-mono"
    placeholder={'{ "type": "object", "properties": {} }'}
    value={data.schema}
    onclick={(e) => e.stopPropagation()}
    oninput={(e) => patch({ schema: (e.target as HTMLTextAreaElement).value })}
  ></textarea>
</div>
