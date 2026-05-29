<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { TransformNodeData } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes, openNodeContextMenu } from '$lib/state/features/flow-editor.svelte';
  import { Braces } from 'lucide-svelte';

  let { data, id }: NodeProps & { data: TransformNodeData } = $props();

  function handleTemplate(e: Event) {
    const template = (e.target as HTMLTextAreaElement).value;
    const next = flowEditorState.nodes.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, template } } : n,
    );
    setNodes(next);
  }
</script>

<Handle type="target" position={Position.Left} id="in" class="!w-3 !h-3 !border-2 !border-slate-400 !bg-slate-900" />
<Handle type="source" position={Position.Right} id="out" class="!w-3 !h-3 !border-2 !border-slate-400 !bg-slate-900" />

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-64 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-1">
    <div class="w-6 h-6 rounded-md bg-slate-500/20 flex items-center justify-center shrink-0">
      <Braces size={12} class="text-slate-300" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate">{data.label || 'Transform'}</span>
  </div>
  <textarea
    class="w-full text-[10px] bg-bg3 border border-border rounded px-1 py-0.5 text-foreground resize-y min-h-12"
    placeholder="Template — use {'{input}'} for the upstream output"
    value={data.template}
    onclick={(e) => e.stopPropagation()}
    oninput={handleTemplate}
  ></textarea>
</div>
