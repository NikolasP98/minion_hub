<script lang="ts">
  import { Select } from '$lib/components/ui';
import { flowEditorState, updateNodeData } from '$lib/state/features/flow-editor.svelte';
  import type { ScheduleNodeData } from '$lib/state/features/flow-editor.svelte';
  import * as m from '$lib/paraglide/messages';

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
    <span class="text-[length:var(--font-size-caption)] font-medium text-foreground">Run every</span>
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
      <Select size="sm"
        class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
        fieldClass="min-w-0 flex-1"
        value={unit}
        onchange={(next) => set({ unit: String(next) as ScheduleNodeData['unit'] })}
      >
        <option value="minutes">Minutes</option>
        <option value="hours">Hours</option>
        <option value="days">Days</option>
      </Select>
    </div>
    <p class="text-[length:var(--font-size-telemetry)] text-muted leading-snug">
      {m.flowcfg_scheduleDesc()}
    </p>
  </div>

  {#if unit === 'days'}
    <label class="flex flex-col gap-1">
      <span class="text-[length:var(--font-size-caption)] font-medium text-foreground">At time (optional)</span>
      <input
        type="time"
        class="w-32 text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
        value={data.atTime ?? ''}
        oninput={(e) => set({ atTime: (e.target as HTMLInputElement).value || undefined })}
      />
      <p class="text-[length:var(--font-size-telemetry)] text-muted leading-snug">{m.flowcfg_atTimeDesc()}</p>
    </label>
  {/if}

  <label class="flex flex-col gap-1">
    <span class="text-[length:var(--font-size-caption)] font-medium text-foreground">Label</span>
    <input
      class="text-xs bg-bg3 border border-border rounded px-2 py-1 text-foreground"
      placeholder={m.flowcfg_schedule()}
      value={data.label ?? ''}
      oninput={(e) => set({ label: (e.target as HTMLInputElement).value })}
    />
  </label>
</div>
