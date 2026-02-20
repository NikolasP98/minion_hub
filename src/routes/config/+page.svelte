<script lang="ts">
  import { conn } from '$lib/state/connection.svelte';
  import { configState, loadConfig, isDirty, groups } from '$lib/state/config.svelte';
  import ConfigSidebar from '$lib/components/config/ConfigSidebar.svelte';
  import ConfigSection from '$lib/components/config/ConfigSection.svelte';
  import ConfigSaveBar from '$lib/components/config/ConfigSaveBar.svelte';

  let contentEl = $state<HTMLElement | null>(null);
  let activeGroupId = $state<string | null>(null);

  $effect(() => {
    if (conn.connected && !configState.loaded && !configState.loading) {
      loadConfig();
    }
    if (!conn.connected && configState.loading) {
      configState.loading = false;
    }
  });

  function scrollToGroup(groupId: string) {
    const el = document.getElementById(`config-group-${groupId}`);
    if (el && contentEl) {
      contentEl.scrollTo({ top: el.offsetTop - contentEl.offsetTop - 16, behavior: 'smooth' });
    }
    activeGroupId = groupId;
  }
</script>

<div class="flex flex-col h-screen overflow-hidden bg-bg text-foreground">
  <!-- Header -->
  <header class="shrink-0 bg-bg/95 backdrop-blur-sm border-b border-border px-4.5 py-2.5 flex items-center">
    <a
      href="/"
      class="text-xs text-muted no-underline px-3 py-1 rounded-full border border-border transition-all duration-150 hover:bg-bg3 hover:text-foreground"
    >
      &larr; Back
    </a>
    <span class="ml-auto mr-auto font-bold text-sm text-foreground tracking-wide uppercase">Configuration</span>
    <div class="invisible text-xs px-3 py-1">&larr; Back</div>
  </header>

  <!-- Body -->
  {#if !conn.connected}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <p class="text-muted-foreground text-sm mb-3">Not connected to a gateway</p>
        <a href="/" class="text-xs text-accent no-underline hover:underline">Go to dashboard</a>
      </div>
    </div>
  {:else if configState.loading && !configState.loaded}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <div class="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p class="text-muted-foreground text-xs">Loading configuration…</p>
      </div>
    </div>
  {:else if configState.loadError}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center max-w-sm">
        <p class="text-destructive text-sm mb-2">Failed to load config</p>
        <p class="text-muted-foreground text-xs mb-4">{configState.loadError}</p>
        <button
          class="bg-accent border-none rounded-[5px] text-white cursor-pointer font-[inherit] text-xs font-semibold py-[6px] px-4"
          onclick={() => loadConfig()}
        >
          Retry
        </button>
      </div>
    </div>
  {:else}
    <div class="flex-1 flex min-h-0">
      <!-- Sidebar -->
      <ConfigSidebar {activeGroupId} onselect={scrollToGroup} />

      <!-- Content -->
      <div class="flex-1 flex flex-col min-h-0">
        <div bind:this={contentEl} class="flex-1 overflow-y-auto px-6 py-5">
          <div class="max-w-3xl mx-auto space-y-8">
            {#if configState.version}
              <p class="text-[10px] text-muted-foreground">
                Gateway v{configState.version} &middot; {configState.configPath}
              </p>
            {/if}

            {#each groups.value as group (group.id)}
              <ConfigSection {group} />
            {/each}

            {#if groups.value.length === 0}
              <p class="text-muted-foreground text-sm">No configuration sections found.</p>
            {/if}
          </div>
        </div>

        <!-- Save bar -->
        {#if isDirty.value || configState.saving || configState.saveError}
          <ConfigSaveBar />
        {/if}
      </div>
    </div>
  {/if}
</div>
