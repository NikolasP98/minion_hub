<script lang="ts">
  import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { PromptBoxData } from '$lib/state/features/flow-editor.svelte';
  import { flowEditorState, setNodes } from '$lib/state/features/flow-editor.svelte';
  import { Type } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let { data, id, selected }: NodeProps & { data: PromptBoxData } = $props();

  let hovered = $state(false);

  const showHandles = $derived(flowEditorState.relationshipMode || selected || hovered);

  function isHandleConnected(handleId: string): boolean {
    return flowEditorState.edges.some(
      (e) =>
        (e.source === id && e.sourceHandle === handleId) ||
        (e.target === id && e.targetHandle === handleId),
    );
  }

  function handleInput(e: Event) {
    const val = (e.target as HTMLTextAreaElement).value;
    // Update node data via state
    setNodes(
      flowEditorState.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, value: val } } : n,
      ),
    );
  }
</script>

<div
  class="bg-bg2 border rounded-xl px-3 py-3 min-w-44 max-w-64 shadow-lg
    {selected ? 'border-accent shadow-accent/20' : 'border-border hover:border-border/80'}"
  role="presentation"
  onmouseenter={() => (hovered = true)}
  onmouseleave={() => (hovered = false)}
  oncontextmenu={(e) => {
    e.preventDefault();
    e.stopPropagation();
    flowEditorState.contextMenu = { open: true, x: e.clientX, y: e.clientY, nodeId: id };
  }}
>
  <div class="flex items-center gap-1.5 mb-2">
    <div class="w-5 h-5 rounded bg-[color-mix(in_srgb,var(--color-purple)_20%,transparent)] flex items-center justify-center shrink-0">
      <Type size={10} class="text-[var(--color-purple)]" />
    </div>
    <span class="text-[length:var(--font-size-caption)] font-semibold text-muted">{data.label || 'Prompt'}</span>
  </div>

  <textarea
    class="w-full text-xs bg-bg3 border border-border rounded-lg px-2 py-1.5 text-foreground resize-none focus:outline-none focus:border-accent/60 min-h-16"
    placeholder={m.flow_enterPromptText()}
    value={data.value}
    oninput={handleInput}
    rows="3"
  ></textarea>
</div>

<!-- Single output handle (right) -->
<Handle
  type="source"
  position={Position.Right}
  id="prompt-out"
  class="!w-3 !h-3 !border-2 !border-[var(--color-success-border)] !bg-[var(--color-success-surface)] {showHandles || isHandleConnected('prompt-out') ? '!opacity-100' : '!opacity-0'} transition-opacity"
/>
