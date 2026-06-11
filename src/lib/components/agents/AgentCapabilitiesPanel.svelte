<script lang="ts">
  import AgentToolsPanel from './AgentToolsPanel.svelte';
  import AgentSkillsPanel from './AgentSkillsPanel.svelte';
  import { agentToolsState } from '$lib/state/agents/agent-tools.svelte';
  import { agentSkillsState } from '$lib/state/agents/agent-skills.svelte';
  import { Wrench, BookOpen } from 'lucide-svelte';

  let { agentId }: { agentId: string } = $props();

  let activeTab = $state<'tools' | 'skills'>('tools');

  const toolsEnabled = $derived(agentToolsState.tools.filter((t) => t.enabled).length);
  const toolsTotal = $derived(agentToolsState.tools.length);
  const skillsEnabled = $derived(
    agentSkillsState.skills.filter((s) => s.agentEnabled && !s.disabled).length,
  );
  const skillsTotal = $derived(agentSkillsState.skills.length);
</script>

<div class="flex-1 min-h-0 flex flex-col overflow-hidden">
  <!-- Sub-tab bar -->
  <div class="shrink-0 flex items-stretch border-b border-border px-2 gap-1 bg-bg2/50">
    <button
      type="button"
      onclick={() => (activeTab = 'tools')}
      class="flex items-center gap-2 px-4 py-2.5 text-[11px] font-semibold border-b-2 transition-colors cursor-pointer rounded-t-sm
        {activeTab === 'tools'
          ? 'border-accent text-accent'
          : 'border-transparent text-muted-foreground hover:text-foreground'}"
    >
      <Wrench size={11} />
      Tools
      {#if toolsTotal > 0}
        <span
          class="tabular-nums text-[10px] px-1.5 py-0.5 rounded-full
            {activeTab === 'tools'
              ? 'bg-accent/15 text-accent'
              : 'bg-border text-muted-foreground'}"
        >
          {toolsEnabled}/{toolsTotal}
        </span>
      {/if}
    </button>
    <button
      type="button"
      onclick={() => (activeTab = 'skills')}
      class="flex items-center gap-2 px-4 py-2.5 text-[11px] font-semibold border-b-2 transition-colors cursor-pointer rounded-t-sm
        {activeTab === 'skills'
          ? 'border-accent text-accent'
          : 'border-transparent text-muted-foreground hover:text-foreground'}"
    >
      <BookOpen size={11} />
      Skills
      {#if skillsTotal > 0}
        <span
          class="tabular-nums text-[10px] px-1.5 py-0.5 rounded-full
            {activeTab === 'skills'
              ? 'bg-accent/15 text-accent'
              : 'bg-border text-muted-foreground'}"
        >
          {skillsEnabled}/{skillsTotal}
        </span>
      {/if}
    </button>
  </div>

  <!-- Content: full height for whichever tab is active -->
  <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
    {#if activeTab === 'tools'}
      <AgentToolsPanel {agentId} />
    {:else}
      <div class="flex-1 min-h-0 flex flex-col overflow-hidden px-4 pb-3 pt-1">
        <AgentSkillsPanel {agentId} />
      </div>
    {/if}
  </div>
</div>
