<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { Button } from '$lib/components/ui';

  let {
    instanceId,
    agentName,
    x,
    y,
    nearbyAgents,
    currentBehavior,
    isConnected,
    onClose,
    onAction,
  }: {
    instanceId: string;
    agentName: string;
    x: number;
    y: number;
    nearbyAgents: Array<{ instanceId: string; name: string }>;
    currentBehavior: 'stationary' | 'wander' | 'patrol';
    isConnected: boolean;
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
<Button
  type="button"
  variant="ghost"
  class="fixed inset-0 z-[var(--layer-dropdown)] w-full h-full rounded-none bg-transparent border-none outline-none cursor-default"
  onclick={onClose}
  oncontextmenu={(e: MouseEvent) => {
    e.preventDefault();
    onClose();
  }}
  aria-label={m.workshop_closeContextMenu()}
></Button>

<!-- Context menu -->
<div
  class="fixed z-[var(--layer-popover)] bg-bg2 border border-border rounded-lg shadow-lg min-w-[180px] py-1 overflow-hidden"
  style="left: {x}px; top: {y}px;"
  role="menu"
>
  <!-- Header: agent name -->
  <div class="text-muted text-xs uppercase tracking-wider px-3 py-1 select-none">
    {agentName}
  </div>

  <!-- Start conversation with... -->
  <div class="relative" class:opacity-40={!isConnected} class:pointer-events-none={!isConnected}>
    <div
      class="px-3 py-1.5 text-xs font-mono text-foreground hover:bg-bg3 cursor-pointer flex items-center justify-between"
      role="menuitem"
      tabindex="0"
      onclick={() => (conversationOpen = !conversationOpen)}
      onkeydown={(e) => e.key === 'Enter' && (conversationOpen = !conversationOpen)}
    >
      <span>{m.workshop_startConversationWith()}</span>
      <span class="text-muted text-xs">{conversationOpen ? '▾' : '▸'}</span>
    </div>
    {#if conversationOpen}
      {#if nearbyAgents.length === 0}
        <div class="pl-6 pr-3 py-1.5 text-xs font-mono text-muted italic">
          {m.workshop_noNearbyAgents()}
        </div>
      {:else}
        {#each nearbyAgents as agent (agent.instanceId)}
          <!-- Agent name label -->
          <div class="pl-6 pr-3 pt-1.5 pb-0.5 text-xs font-mono text-muted select-none">
            {agent.name}
          </div>
          <!-- Chat now sub-option -->
          <div
            class="pl-9 pr-3 py-1 text-xs font-mono text-foreground hover:bg-bg3 cursor-pointer"
            role="menuitem"
            tabindex="0"
            onclick={() => handleAction('quickBanter', { targetInstanceId: agent.instanceId })}
            onkeydown={(e) =>
              e.key === 'Enter' &&
              handleAction('quickBanter', { targetInstanceId: agent.instanceId })}
          >
            {m.workshop_chatNow()}
          </div>
          <!-- Custom topic sub-option -->
          <div
            class="pl-9 pr-3 py-1 text-xs font-mono text-foreground hover:bg-bg3 cursor-pointer"
            role="menuitem"
            tabindex="0"
            onclick={() =>
              handleAction('startConversation', { targetInstanceId: agent.instanceId })}
            onkeydown={(e) =>
              e.key === 'Enter' &&
              handleAction('startConversation', { targetInstanceId: agent.instanceId })}
          >
            {m.workshop_customTopic()}
          </div>
        {/each}
      {/if}
    {/if}
    {#if !isConnected}
      <div class="px-3 pb-1 text-xs font-mono text-muted italic">{m.workshop_notConnected()}</div>
    {/if}
  </div>

  <!-- Assign task -->
  <div class="relative" class:opacity-40={!isConnected} class:pointer-events-none={!isConnected}>
    <div
      class="px-3 py-1.5 text-xs font-mono text-foreground hover:bg-bg3 cursor-pointer"
      role="menuitem"
      tabindex="0"
      onclick={() => handleAction('assignTask')}
      onkeydown={(e) => e.key === 'Enter' && handleAction('assignTask')}
    >
      {m.workshop_assignTask()}
    </div>
    {#if !isConnected}
      <div class="px-3 pb-1 text-xs font-mono text-muted italic">{m.workshop_notConnected()}</div>
    {/if}
  </div>

  <!-- Separator -->
  <div class="h-px bg-border my-1"></div>

  <!-- Behavior submenu -->
  <div class="relative">
    <div
      class="px-3 py-1.5 text-xs font-mono text-foreground hover:bg-bg3 cursor-pointer flex items-center justify-between"
      role="menuitem"
      tabindex="0"
      onclick={() => (behaviorOpen = !behaviorOpen)}
      onkeydown={(e) => e.key === 'Enter' && (behaviorOpen = !behaviorOpen)}
    >
      <span>{m.workshop_behavior()}</span>
      <span class="text-muted text-xs">{behaviorOpen ? '▾' : '▸'}</span>
    </div>
    {#if behaviorOpen}
      {#each [{ value: 'stationary', label: m.workshop_behaviorStationary() }, { value: 'wander', label: m.workshop_behaviorWander() }, { value: 'patrol', label: m.workshop_behaviorPatrol() }] as mode (mode.value)}
        {@const isActive = currentBehavior === mode.value}
        <div
          class="pl-6 pr-3 py-1.5 text-xs font-mono text-foreground hover:bg-bg3 cursor-pointer flex items-center gap-1.5"
          role="menuitem"
          tabindex="0"
          onclick={() => handleAction('setBehavior', mode.value)}
          onkeydown={(e) => e.key === 'Enter' && handleAction('setBehavior', mode.value)}
        >
          <span class="text-xs w-3 text-center {isActive ? 'text-foreground' : 'text-transparent'}"
            >●</span
          >
          <span>{mode.label}</span>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Separator -->
  <div class="h-px bg-border my-1"></div>

  <!-- Remove from canvas (destructive) -->
  <div
    class="px-3 py-1.5 text-xs font-mono text-destructive hover:bg-destructive/10 cursor-pointer"
    role="menuitem"
    tabindex="0"
    onclick={() => handleAction('remove')}
    onkeydown={(e) => e.key === 'Enter' && handleAction('remove')}
  >
    {m.workshop_removeFromCanvas()}
  </div>
</div>
