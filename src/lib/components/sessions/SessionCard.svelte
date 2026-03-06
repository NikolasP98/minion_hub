<script lang="ts">
  import { fmtTimeAgo, truncKey } from '$lib/utils/format';

  let { session, status }: { session: unknown; status: string } = $props();

  const s = $derived(session as {
    sessionKey?: string;
    label?: string;
    model?: string;
    lastActiveAt?: number;
    createdAt?: number;
  });
</script>

<div class="bg-bg3 border border-border rounded-[5px] px-2 py-[7px] mb-[5px] text-[11px] font-mono transition-colors hover:border-accent">
  <div class="flex items-center gap-[5px]">
    <span
      class="w-1.5 h-1.5 rounded-full shrink-0
        {status === 'running'  ? 'bg-status-running shadow-[0_0_5px_var(--color-status-running)]' : ''}
        {status === 'thinking' ? 'bg-status-thinking animate-dot-pulse' : ''}
        {status === 'idle'     ? 'bg-status-idle' : ''}
        {status === 'aborted'  ? 'bg-status-aborted' : ''}"
    ></span>
    <span class="text-foreground font-medium whitespace-nowrap overflow-hidden text-ellipsis flex-1 min-w-0">{truncKey(s.sessionKey)}</span>
  </div>
  {#if s.label}
    <div class="text-muted text-[10px] mt-[2px] whitespace-nowrap overflow-hidden text-ellipsis">{s.label}</div>
  {/if}
  <div class="text-muted-foreground mt-[3px] flex gap-1.5 items-center">
    {#if s.model}
      <span class="text-accent text-[10px]">{s.model}</span>
    {/if}
    <span class="text-[10px]">{fmtTimeAgo(s.lastActiveAt ?? s.createdAt)}</span>
  </div>
</div>
