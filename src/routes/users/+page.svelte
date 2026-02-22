<script lang="ts">
  import Topbar from '$lib/components/Topbar.svelte';
  import TeamTab from '$lib/components/users/TeamTab.svelte';
  import BindingsTab from '$lib/components/users/BindingsTab.svelte';
  import { conn } from '$lib/state/connection.svelte';
  import { configState, loadConfig } from '$lib/state/config.svelte';
  import * as m from '$lib/paraglide/messages';

  type Tab = 'team' | 'bindings';
  let activeTab = $state<Tab>('team');

  // Load gateway config when switching to bindings tab (if not already loaded)
  $effect(() => {
    if (activeTab === 'bindings' && conn.connected && !configState.loaded && !configState.loading) {
      loadConfig();
    }
  });
</script>

<div class="relative z-10 flex flex-col h-screen overflow-hidden text-foreground">
  <Topbar />

  <!-- Tab bar -->
  <div class="shrink-0 border-b border-border bg-bg/95 backdrop-blur-sm px-4.5 flex items-center gap-1">
    {#each (['team', 'bindings'] as Tab[]) as tab (tab)}
      <button
        class="text-xs px-3.5 py-2.5 border-b-2 transition-colors duration-100 bg-transparent border-0 cursor-pointer font-[inherit] capitalize
          {activeTab === tab
            ? 'border-b-accent text-foreground font-semibold'
            : 'border-b-transparent text-muted hover:text-foreground'}"
        onclick={() => (activeTab = tab)}
      >
        {tab === 'team' ? m.users_team() : m.users_bindings()}
      </button>
    {/each}
  </div>

  <!-- Content -->
  <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
    {#if activeTab === 'team'}
      <TeamTab />
    {:else}
      <BindingsTab />
    {/if}
  </div>
</div>
