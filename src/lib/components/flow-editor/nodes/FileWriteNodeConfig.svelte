<script lang="ts">
  import { Select } from '$lib/components/ui';
import { flowEditorState, updateNodeData } from '$lib/state/features/flow-editor.svelte';
  import type { FileWriteNodeData } from '$lib/state/features/flow-editor.svelte';
  import * as m from '$lib/paraglide/messages';

  let { nodeId }: { nodeId: string } = $props();

  const node = $derived(flowEditorState.nodes.find((n) => n.id === nodeId));
  const data = $derived((node?.data ?? {}) as FileWriteNodeData);

  function set(patch: Partial<FileWriteNodeData>) {
    updateNodeData(nodeId, patch as Record<string, unknown>);
  }
</script>

<div class="px-3 py-3 flex flex-col gap-3">
  <label class="flex flex-col gap-1">
    <span class="text-[length:var(--font-size-caption)] font-medium text-foreground">File path</span>
    <input
      class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground font-mono"
      placeholder={'report-{date}.md'}
      value={data.path ?? ''}
      oninput={(e) => set({ path: (e.target as HTMLInputElement).value })}
    />
    <p class="text-[length:var(--font-size-telemetry)] text-muted leading-snug">
      {m.flowcfg_filePathDesc({ date: '{date}' })}
    </p>
  </label>

  <div class="flex flex-col gap-1">
    <span class="text-[length:var(--font-size-caption)] font-medium text-foreground">Mode</span>
    <Select size="sm"
      class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
      fieldClass="w-full"
      value={data.mode ?? 'overwrite'}
      onchange={(next) => set({ mode: String(next) as 'overwrite' | 'append' })}
    >
      <option value="overwrite">{m.flowcfg_overwrite()}</option>
      <option value="append">{m.flowcfg_appendNewlineSeparated()}</option>
    </Select>
  </div>

  <label class="flex flex-col gap-1">
    <span class="text-[length:var(--font-size-caption)] font-medium text-foreground">Label</span>
    <input
      class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
      placeholder={m.flowcfg_writeFile()}
      value={data.label ?? ''}
      oninput={(e) => set({ label: (e.target as HTMLInputElement).value })}
    />
  </label>
</div>
