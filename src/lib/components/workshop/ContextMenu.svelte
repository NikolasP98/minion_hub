<script lang="ts">
  let {
    instanceId,
    agentName,
    x,
    y,
    nearbyAgents,
    onClose,
    onAction,
  }: {
    instanceId: string;
    agentName: string;
    x: number;
    y: number;
    nearbyAgents: Array<{ instanceId: string; name: string }>;
    onClose: () => void;
    onAction: (action: string, data?: unknown) => void;
  } = $props();

  let conversationOpen = $state(false);
  let behaviorOpen = $state(false);

  function handleAction(action: string, data?: unknown) {
    onAction(action, data);
    onClose();
  }

  $effect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  });
</script>

<!-- Transparent backdrop to catch outside clicks -->
<button
  type="button"
  class="fixed inset-0 z-[999] w-full h-full bg-transparent border-none outline-none cursor-default"
  onclick={onClose}
  oncontextmenu={(e) => { e.preventDefault(); onClose(); }}
  aria-label="Close context menu"
></button>

<!-- Context menu -->
<div
  class="fixed z-[1000] bg-bg2 border border-border rounded-lg shadow-lg min-w-[180px] py-1 overflow-hidden"
  style="left: {x}px; top: {y}px;"
  role="menu"
>
  <!-- Header: agent name -->
  <div class="text-muted text-[9px] uppercase tracking-wider px-3 py-1 select-none">
    {agentName}
  </div>

  <!-- Start conversation with... -->
  <div class="relative">
    <div
      class="px-3 py-1.5 text-[11px] font-mono text-foreground hover:bg-bg3 cursor-pointer flex items-center justify-between"
      role="menuitem"
      tabindex="0"
      onclick={() => (conversationOpen = !conversationOpen)}
      onkeydown={(e) => e.key === 'Enter' && (conversationOpen = !conversationOpen)}
    >
      <span>Start conversation with…</span>
      <span class="text-muted-foreground text-[9px]">{conversationOpen ? '▾' : '▸'}</span>
    </div>
    {#if conversationOpen}
      {#if nearbyAgents.length === 0}
        <div class="pl-6 pr-3 py-1.5 text-[11px] font-mono text-muted-foreground italic">
          No nearby agents
        </div>
      {:else}
        {#each nearbyAgents as agent (agent.instanceId)}
          <div
            class="pl-6 pr-3 py-1.5 text-[11px] font-mono text-foreground hover:bg-bg3 cursor-pointer"
            role="menuitem"
            tabindex="0"
            onclick={() => handleAction('startConversation', { targetInstanceId: agent.instanceId })}
            onkeydown={(e) => e.key === 'Enter' && handleAction('startConversation', { targetInstanceId: agent.instanceId })}
          >
            {agent.name}
          </div>
        {/each}
      {/if}
    {/if}
  </div>

  <!-- Assign task -->
  <div
    class="px-3 py-1.5 text-[11px] font-mono text-foreground hover:bg-bg3 cursor-pointer"
    role="menuitem"
    tabindex="0"
    onclick={() => handleAction('assignTask')}
    onkeydown={(e) => e.key === 'Enter' && handleAction('assignTask')}
  >
    Assign task
  </div>

  <!-- Separator -->
  <div class="h-px bg-border my-1"></div>

  <!-- Behavior submenu -->
  <div class="relative">
    <div
      class="px-3 py-1.5 text-[11px] font-mono text-foreground hover:bg-bg3 cursor-pointer flex items-center justify-between"
      role="menuitem"
      tabindex="0"
      onclick={() => (behaviorOpen = !behaviorOpen)}
      onkeydown={(e) => e.key === 'Enter' && (behaviorOpen = !behaviorOpen)}
    >
      <span>Behavior</span>
      <span class="text-muted-foreground text-[9px]">{behaviorOpen ? '▾' : '▸'}</span>
    </div>
    {#if behaviorOpen}
      {#each ['Stationary', 'Wander', 'Patrol'] as mode (mode)}
        <div
          class="pl-6 pr-3 py-1.5 text-[11px] font-mono text-foreground hover:bg-bg3 cursor-pointer"
          role="menuitem"
          tabindex="0"
          onclick={() => handleAction('setBehavior', mode.toLowerCase())}
          onkeydown={(e) => e.key === 'Enter' && handleAction('setBehavior', mode.toLowerCase())}
        >
          {mode}
        </div>
      {/each}
    {/if}
  </div>

  <!-- Separator -->
  <div class="h-px bg-border my-1"></div>

  <!-- Remove from canvas (destructive) -->
  <div
    class="px-3 py-1.5 text-[11px] font-mono text-destructive hover:bg-destructive/10 cursor-pointer"
    role="menuitem"
    tabindex="0"
    onclick={() => handleAction('remove')}
    onkeydown={(e) => e.key === 'Enter' && handleAction('remove')}
  >
    Remove from canvas
  </div>
</div>
