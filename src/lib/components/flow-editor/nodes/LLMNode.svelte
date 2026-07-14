<script lang="ts">
  import { Select } from '$lib/components/ui';
import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { LLMNodeData } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes, openNodeContextMenu } from '$lib/state/features/flow-editor.svelte';
  import { Cpu } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';

  let { data, id }: NodeProps & { data: LLMNodeData } = $props();

  interface ModelItem { id: string; name: string }
  let models = $state<ModelItem[]>([]);
  let defaultFallback = $state(false);

  const FALLBACK_MODELS: ModelItem[] = [
    { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
    { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-7', name: 'Claude Opus 4.7' },
  ];

  onMount(async () => {
    try {
      const res = await sendRequest('models.list', {}) as {
        models?: ModelItem[];
        defaultModel?: string;
      } | null;
      if (res?.models && res.models.length > 0) {
        models = res.models;
        if (!data.modelId && res.defaultModel) {
          const found = res.models.find((m) => m.id === res.defaultModel);
          pickModel(res.defaultModel, found?.name ?? res.defaultModel);
        }
      } else {
        models = FALLBACK_MODELS;
        defaultFallback = true;
      }
    } catch {
      models = FALLBACK_MODELS;
      defaultFallback = true;
    }
  });

  function pickModel(modelId: string, label: string) {
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, modelId, label } } : n,
    );
    setNodes(next);
  }

  function handleChange(value: string | number) {
    const modelId = String(value);
    const label = models.find((m) => m.id === modelId)?.name ?? modelId;
    pickModel(modelId, label);
  }
</script>

<Handle
  type="source"
  position={Position.Right}
  id="out"
  class="!w-3 !h-3 !border-2 !border-[var(--color-success-border)] !bg-[var(--color-success-surface)]"
/>

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-44 max-w-56 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)] flex items-center justify-center shrink-0">
      <Cpu size={12} class="text-[var(--color-purple)]" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate">
      {data.label || 'LLM'}
    </span>
  </div>

  {#if defaultFallback}
    <p class="text-[length:var(--font-size-telemetry)] text-[var(--color-warning-fg)]/80 mb-1">Server offline — showing defaults</p>
  {/if}

  <Select size="sm"
    class="w-full text-[length:var(--font-size-telemetry)] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground"
    value={data.modelId}
    onclick={(e: MouseEvent) => e.stopPropagation()}
    onchange={handleChange}
  >
    {#each models as m (m.id)}
      <option value={m.id}>{m.name ?? m.id}</option>
    {/each}
    {#if data.modelId && !models.some((m) => m.id === data.modelId)}
      <option value={data.modelId}>{data.label || data.modelId}</option>
    {/if}
  </Select>
</div>
