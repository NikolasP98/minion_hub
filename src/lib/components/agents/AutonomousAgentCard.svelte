<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { Zap, Settings2, Workflow, MoreVertical, ArrowUpRight } from 'lucide-svelte';
  import { StatusDot, Dropdown, type DropdownItem } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import type { AutonomousAgentVM } from '$lib/agents/autonomous';
  import type { ArtifactDescriptor } from '$lib/agents/artifacts';
  import ArtifactGallery from '$lib/components/artifacts/ArtifactGallery.svelte';
  import ArtifactCreateModal from '$lib/components/artifacts/ArtifactCreateModal.svelte';
  import ArtifactRegenerateModal from '$lib/components/artifacts/ArtifactRegenerateModal.svelte';
  import ArtifactHistory from '$lib/components/artifacts/ArtifactHistory.svelte';
  import { agentWindows } from '$lib/state/ui/agent-windows.svelte';

  let {
    agent,
    artifacts = [],
    canAdd = false,
  }: { agent: AutonomousAgentVM; artifacts?: ArtifactDescriptor[]; canAdd?: boolean } = $props();

  let showCreate = $state(false);
  let regenFor = $state<ArtifactDescriptor | null>(null);
  let historyFor = $state<ArtifactDescriptor | null>(null);

  const statusLabel = $derived(
    agent.status.state === 'active'
      ? m.autonomous_status_active()
      : agent.status.state === 'attention'
        ? m.autonomous_status_attention()
        : m.autonomous_status_disabled(),
  );

  const stats = $derived(agent.status.stats);

  const menuItems = $derived<DropdownItem[]>([
    ...(agent.flowId
      ? [{ value: 'view-flow', label: m.autonomous_view_flow(), icon: Workflow }]
      : []),
    { value: 'manage', label: m.autonomous_manage(), icon: Settings2 },
  ]);

  const detailHref = $derived(`/agents/autonomous/${encodeURIComponent(agent.id)}`);

  function onMenu(value: string) {
    if (value === 'view-flow' && agent.flowId) agentWindows.openFlow(agent.flowId, agent.name);
    else if (value === 'manage') goto(detailHref);
  }
</script>

<article
  class="group/card flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:border-white/20"
>
  <header class="flex items-start gap-3">
    <img
      src={agent.avatarUrl}
      alt=""
      class="size-11 shrink-0 rounded-lg bg-white/5 ring-1 ring-white/10"
      loading="lazy"
    />
    <div class="min-w-0 flex-1">
      <a
        href={detailHref}
        class="group/name inline-flex max-w-full items-center gap-1 text-sm font-semibold text-white hover:underline"
      >
        <span class="truncate">{agent.name}</span>
        <ArrowUpRight
          size={13}
          class="shrink-0 opacity-0 transition-opacity group-hover/name:opacity-100"
        />
      </a>
      {#if agent.role}
        <p class="truncate text-xs text-white/50">{agent.role}</p>
      {/if}
    </div>
    <div class="flex shrink-0 items-center gap-1">
      <StatusDot state={agent.status.state} label={statusLabel} />
      <Dropdown items={menuItems} onSelect={onMenu} placement="bottom">
        {#snippet trigger()}
          <span
            class="grid size-7 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white"
            aria-label={m.autonomous_manage()}
          >
            <MoreVertical size={15} />
          </span>
        {/snippet}
      </Dropdown>
    </div>
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

  {#if agent.status.detail || stats}
    <footer class="mt-auto pt-1 text-[11px] text-white/40">
      {#if agent.status.detail}
        {agent.status.detail}
      {:else if stats}
        {m.autonomous_activity({ sent: stats.sent, failed: stats.failed })}
      {/if}
    </footer>
  {/if}

  {#if artifacts.length || canAdd}
    <ArtifactGallery
      {artifacts}
      {canAdd}
      onopen={(a) => agentWindows.openArtifact(a)}
      oncreate={() => (showCreate = true)}
      ondelete={async (a) => {
        await fetch(`/api/artifacts/${a.id}`, { method: 'DELETE' });
        await invalidateAll();
      }}
      onregenerate={(a) => (regenFor = a)}
      onhistory={(a) => (historyFor = a)}
    />
  {/if}
</article>

<ArtifactCreateModal bind:open={showCreate} agentId={agent.id} oncreated={() => invalidateAll()} />

{#if regenFor}
  {@const _artifactId = regenFor.id}
  <ArtifactRegenerateModal
    bind:open={
      () => !!regenFor,
      (v) => { if (!v) regenFor = null; }
    }
    artifactId={_artifactId}
    ondone={async () => { regenFor = null; await invalidateAll(); }}
  />
{/if}

{#if historyFor}
  {@const _historyArtifactId = historyFor.id}
  <ArtifactHistory
    bind:open={
      () => !!historyFor,
      (v) => { if (!v) historyFor = null; }
    }
    artifactId={_historyArtifactId}
    onreverted={async () => { await invalidateAll(); }}
  />
{/if}
