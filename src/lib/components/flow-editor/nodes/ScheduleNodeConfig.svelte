<script lang="ts">
  import { flowEditorState, updateNodeData } from '$lib/state/features/flow-editor.svelte';
  import type { ScheduleNodeData } from '$lib/state/features/flow-editor.svelte';

  let { nodeId }: { nodeId: string } = $props();

  const node = $derived(flowEditorState.nodes.find((n) => n.id === nodeId));
  const data = $derived((node?.data ?? {}) as ScheduleNodeData);

  const unit = $derived(data.unit ?? 'days');

  function set(patch: Partial<ScheduleNodeData>) {
    updateNodeData(nodeId, patch as Record<string, unknown>);
  }
</script>

<div class="px-3 py-3 flex flex-col gap-3">
  <div class="flex flex-col gap-1">
    <span class="text-[11px] font-medium text-foreground">Run every</span>
    <div class="flex items-center gap-2">
      <input
        type="number"
        min="1"
        class="w-20 text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
        value={typeof data.every === 'number' ? data.every : 1}
        oninput={(e) => {
          const v = Number((e.target as HTMLInputElement).value);
          set({ every: Number.isFinite(v) && v > 0 ? v : 1 });
        }}
      />
      <select
        class="flex-1 text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
        value={unit}
        onchange={(e) => set({ unit: (e.target as HTMLSelectElement).value as ScheduleNodeData['unit'] })}
      >
        <option value="minutes">Minutes</option>
        <option value="hours">Hours</option>
        <option value="days">Days</option>
      </select>
    </div>
    <p class="text-[10px] text-muted leading-snug">
      The flow fires on this interval once activated. A scheduled run has no inbound
      message — fetch what you need inside the flow (e.g. a DB Query node).
    </p>
  </div>

  {#if unit === 'days'}
    <label class="flex flex-col gap-1">
      <span class="text-[11px] font-medium text-foreground">At time (optional)</span>
      <input
        type="time"
        class="w-32 text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
        value={data.atTime ?? ''}
        oninput={(e) => set({ atTime: (e.target as HTMLInputElement).value || undefined })}
      />
      <p class="text-[10px] text-muted leading-snug">Fire at or after this local time on its scheduled day.</p>
    </label>
  {/if}

  <label class="flex flex-col gap-1">
    <span class="text-[11px] font-medium text-foreground">Label</span>
    <input
      class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
      placeholder="Schedule"
      value={data.label ?? ''}
      oninput={(e) => set({ label: (e.target as HTMLInputElement).value })}
    />
  </label>
</div>
