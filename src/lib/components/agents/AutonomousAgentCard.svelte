<script lang="ts">
  import { goto } from '$app/navigation';
  import { Zap, Settings2 } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import type { AutonomousAgentVM } from '$lib/agents/autonomous';

  let { agent }: { agent: AutonomousAgentVM } = $props();

  const statusLabel = $derived(
    agent.status.state === 'active'
      ? m.autonomous_status_active()
      : agent.status.state === 'attention'
        ? m.autonomous_status_attention()
        : m.autonomous_status_disabled(),
  );

  // Tailwind tone per state.
  const statusTone = $derived(
    agent.status.state === 'active'
      ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'
      : agent.status.state === 'attention'
        ? 'bg-amber-500/15 text-amber-300 ring-amber-500/30'
        : 'bg-white/5 text-white/50 ring-white/10',
  );

  const stats = $derived(agent.status.stats);
</script>

<article
  class="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/20"
>
  <header class="flex items-start gap-3">
    <img
      src={agent.avatarUrl}
      alt=""
      class="size-11 shrink-0 rounded-lg bg-white/5 ring-1 ring-white/10"
      loading="lazy"
    />
    <div class="min-w-0 flex-1">
      <h3 class="truncate text-sm font-semibold text-white">{agent.name}</h3>
      {#if agent.role}
        <p class="truncate text-xs text-white/50">{agent.role}</p>
      {/if}
    </div>
    <span
      class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 {statusTone}"
    >
      {statusLabel}
    </span>
  </header>

  {#if agent.description}
    <p class="line-clamp-2 text-xs leading-relaxed text-white/60">{agent.description}</p>
  {/if}

  {#if agent.trigger}
    <div class="flex items-center gap-1.5 text-[11px] text-white/45">
      <Zap size={12} />
      <span class="truncate">{agent.trigger}</span>
    </div>
  {/if}

  <footer class="mt-auto flex items-center justify-between gap-2 pt-1">
    <span class="text-[11px] text-white/40">
      {#if agent.status.detail}
        {agent.status.detail}
      {:else if stats}
        {stats.sent} sent · {stats.failed} failed · 30d
      {/if}
    </span>
    {#if agent.managePath}
      <button
        type="button"
        onclick={() => goto(agent.managePath!)}
        class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/80 transition-colors hover:bg-white/10"
      >
        <Settings2 size={13} />
        {m.autonomous_manage()}
      </button>
    {/if}
  </footer>
</article>
