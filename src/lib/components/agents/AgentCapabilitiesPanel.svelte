<script lang="ts">
  import AgentToolsPanel from './AgentToolsPanel.svelte';
  import AgentSkillsPanel from './AgentSkillsPanel.svelte';

  let { agentId }: { agentId: string } = $props();
</script>

<div class="flex-1 min-h-0 flex flex-col overflow-hidden">
  <!-- Tools section -->
  <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
    <div class="shrink-0 px-4 pt-3 pb-2 border-b border-border/60 flex items-center gap-2">
      <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Tools</span>
    </div>
    <div class="flex-1 min-h-0 overflow-hidden">
      <AgentToolsPanel {agentId} />
    </div>
  </div>

  <!-- Skills section -->
  <div class="flex-1 min-h-0 flex flex-col overflow-hidden border-t-2 border-border">
    <div class="shrink-0 px-4 pt-3 pb-2 border-b border-border/60 flex items-center gap-2">
      <span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Skills</span>
    </div>
    <div class="flex-1 min-h-0 overflow-hidden px-4 pb-3">
      <AgentSkillsPanel {agentId} />
    </div>
  </div>
</div>
