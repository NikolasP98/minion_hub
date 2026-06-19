<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { ArrowLeft, Settings2, Zap } from 'lucide-svelte';
  import ArtifactHost from '$lib/components/artifacts/ArtifactHost.svelte';
  import type { AutonomousAgentVM } from '$lib/agents/autonomous';
  import type { ArtifactDescriptor } from '$lib/agents/artifacts';

  let { data }: { data: { agent: AutonomousAgentVM; artifacts: ArtifactDescriptor[] } } = $props();
  const agent = $derived(data.agent);
</script>

<div class="flex h-full flex-col overflow-hidden p-6">
  <a href="/agents/autonomous" class="mb-4 inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white/80">
    <ArrowLeft size={13} /> {m.autonomous_detail_back()}
  </a>

  <header class="mb-5 flex items-start gap-3">
    <img src={agent.avatarUrl} alt="" class="size-12 shrink-0 rounded-lg bg-white/5 ring-1 ring-white/10" />
    <div class="min-w-0 flex-1">
      <h1 class="text-lg font-semibold text-white">{agent.name}</h1>
      {#if agent.role}<p class="text-sm text-white/50">{agent.role}</p>{/if}
      {#if agent.trigger}
        <p class="mt-1 inline-flex items-center gap-1.5 text-[11px] text-white/45"><Zap size={12} /> {agent.trigger}</p>
      {/if}
    </div>
    {#if agent.managePath}
      <a href={agent.managePath} class="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/80 hover:bg-white/10">
        <Settings2 size={13} /> {m.autonomous_detail_manage()}
      </a>
    {/if}
  </header>

  <div class="grid min-h-0 flex-1 grid-cols-1 gap-3">
    {#each data.artifacts as artifact (artifact.id)}
      <div class="min-h-[24rem]">
        <ArtifactHost descriptor={artifact} />
      </div>
    {/each}
  </div>
</div>
