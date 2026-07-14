<script lang="ts">
  import { Button } from '$lib/components/ui';
import { Handle, Position } from '@xyflow/svelte';
  import type { NodeProps } from '@xyflow/svelte';
  import type { ScheduleNodeData } from '$lib/state/features/flow-editor.svelte';
  import { openNodeContextMenu, openNodeConfig } from '$lib/state/features/flow-editor.svelte';
  import { Clock, Settings2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';

  let { data, id }: NodeProps & { data: ScheduleNodeData } = $props();

  const every = $derived(typeof data.every === 'number' && data.every > 0 ? data.every : 1);
  const unit = $derived(data.unit ?? 'days');
  const cadence = $derived(`every ${every} ${every === 1 ? unit.replace(/s$/, '') : unit}`);
  const atTime = $derived(unit === 'days' && data.atTime ? ` at ${data.atTime}` : '');
</script>

<Handle
  type="source"
  position={Position.Right}
  id="out"
  class="!w-3 !h-3 !border-2 !border-[var(--color-warning-border)] !bg-[var(--color-warning-surface)]"
/>

<div
  class="relative bg-bg2 border rounded-xl px-4 py-3 min-w-48 max-w-60 shadow-lg select-none border-border hover:border-border/80"
  oncontextmenu={(e) => openNodeContextMenu(e, id)}
  ondblclick={() => openNodeConfig(id)}
  role="presentation"
>
  <div class="flex items-center gap-2 mb-1.5">
    <div class="w-6 h-6 rounded-md bg-[var(--color-warning-surface)] flex items-center justify-center shrink-0">
      <Clock size={12} class="text-[var(--color-warning-fg)]" />
    </div>
    <span class="text-xs font-semibold text-foreground truncate flex-1">{m.flownode_schedule()}</span>
    <Button variant="ghost"
      class="shrink-0 text-muted/60 hover:text-foreground transition-colors"
      title={m.flownode_configureSchedule()}
      aria-label={m.flownode_configureSchedule()}
      onclick={(e) => { e.stopPropagation(); openNodeConfig(id); }}
    >
      <Settings2 size={12} />
    </Button>
  </div>
  <span class="inline-block text-[length:var(--font-size-telemetry)] font-medium px-1.5 py-0.5 rounded bg-[var(--color-warning-surface)] text-[var(--color-warning-fg)]">
    {cadence}{atTime}
  </span>
</div>
