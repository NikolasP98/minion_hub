<script lang="ts">
  import { Button, Select } from '$lib/components/ui';
import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { ToolAgentNodeData, ToolRef } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes, openNodeContextMenu } from '$lib/state/features/flow-editor.svelte';
  import { sendRequest } from '$lib/services/gateway.svelte';
  import { Wrench, Plus, X } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  let { data, id }: NodeProps & { data: ToolAgentNodeData } = $props();

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

  function patch(partial: Partial<ToolAgentNodeData>) {
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, ...partial } } : n,
    );
    setNodes(next);
  }

  const BUILTIN_TOOLS: { id: string; label: string }[] = [
    { id: 'web_search', label: 'Web search' },
    { id: 'current_time', label: 'Current time' },
    { id: 'calculator', label: 'Calculator' },
  ];

  function hasBuiltin(toolId: string): boolean {
    return data.tools.some((t) => t.kind === 'builtin' && t.id === toolId);
  }

  function toggleBuiltin(toolId: string) {
    const next: ToolRef[] = hasBuiltin(toolId)
      ? data.tools.filter((t) => !(t.kind === 'builtin' && t.id === toolId))
      : [...data.tools, { kind: 'builtin', id: toolId }];
    patch({ tools: next });
  }

  const gatewayTools = $derived(
    data.tools.filter((t): t is Extract<ToolRef, { kind: 'gateway' }> => t.kind === 'gateway'),
  );

  let methodInput = $state('');

  function addGatewayTool() {
    const method = methodInput.trim();
    if (!method) return;
    if (data.tools.some((t) => t.kind === 'gateway' && t.method === method)) {
      methodInput = '';
      return;
    }
    const segments = method.split('.');
    const name = segments[segments.length - 1] || method;
    patch({ tools: [...data.tools, { kind: 'gateway', method, name, description: method }] });
    methodInput = '';
  }

  function removeGatewayTool(method: string) {
    patch({ tools: data.tools.filter((t) => !(t.kind === 'gateway' && t.method === method)) });
  }
</script>

<Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-[color-mix(in_srgb,var(--color-purple)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)]" />
<Handle type="source" position={Position.Right} id="out" class="!w-3 !h-3 !border-2 !border-[color-mix(in_srgb,var(--color-purple)_30%,transparent)] !bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)]" />

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-56 max-w-72 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-2">
    <div class="w-6 h-6 rounded-md bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)] flex items-center justify-center shrink-0">
      <Wrench size={12} class="text-[var(--color-purple)]" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate">{data.label || m.flowcfg_toolAgent()}</span>
  </div>

  <Select size="sm"
    class="w-full text-[length:var(--font-size-telemetry)] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground mb-2"
    value={data.modelId}
    onclick={(e: MouseEvent) => e.stopPropagation()}
    onchange={(next) => patch({ modelId: String(next) })}
  >
    {#each models as mdl (mdl.id)}
      <option value={mdl.id}>{mdl.name ?? mdl.id}</option>
    {/each}
  </Select>

  <textarea
    class="w-full text-[length:var(--font-size-telemetry)] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground resize-y min-h-12 mb-2"
    placeholder={m.flowcfg_systemPrompt()}
    value={data.systemPrompt ?? ''}
    onclick={(e) => e.stopPropagation()}
    oninput={(e) => patch({ systemPrompt: (e.target as HTMLTextAreaElement).value })}
  ></textarea>

  <div class="text-[length:var(--font-size-telemetry)] font-semibold text-muted uppercase tracking-wide mb-1">Built-in tools</div>
  <div class="flex flex-col gap-1 mb-2">
    {#each BUILTIN_TOOLS as tool (tool.id)}
      <label class="flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          class="w-3 h-3 accent-violet-400"
          checked={hasBuiltin(tool.id)}
          onclick={(e) => e.stopPropagation()}
          onchange={() => toggleBuiltin(tool.id)}
        />
        <span class="text-[length:var(--font-size-telemetry)] text-muted">{tool.label}</span>
      </label>
    {/each}
  </div>

  <div class="text-[length:var(--font-size-telemetry)] font-semibold text-muted uppercase tracking-wide mb-1">Server tools</div>
  {#if gatewayTools.length}
    <div class="flex flex-col gap-1 mb-1.5">
      {#each gatewayTools as tool (tool.method)}
        <div class="flex items-center gap-1 bg-bg3 border border-border rounded px-1 py-0.5">
          <span class="flex-1 text-[length:var(--font-size-telemetry)] text-foreground truncate" title={tool.method}>{tool.method}</span>
          <Button variant="ghost"
            class="text-muted/60 hover:text-[var(--color-danger-fg)]"
            onclick={(e) => { e.stopPropagation(); removeGatewayTool(tool.method); }}
            title={m.flowcfg_removeTool()}
            aria-label={m.flowcfg_removeTool()}
          >
            <X size={11} />
          </Button>
        </div>
      {/each}
    </div>
  {/if}

  <div class="flex items-center gap-1">
    <input
      class="flex-1 text-[length:var(--font-size-telemetry)] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground"
      placeholder={m.flowcfg_pluginMethod()}
      value={methodInput}
      onclick={(e) => e.stopPropagation()}
      oninput={(e) => (methodInput = (e.target as HTMLInputElement).value)}
      onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addGatewayTool(); } }}
    />
    <Button variant="ghost"
      class="flex items-center gap-1 text-[length:var(--font-size-telemetry)] text-[var(--color-purple)] hover:text-[var(--color-purple)] shrink-0"
      onclick={(e) => { e.stopPropagation(); addGatewayTool(); }}
    >
      <Plus size={11} /> {m.common_add()}
    </Button>
  </div>
</div>
