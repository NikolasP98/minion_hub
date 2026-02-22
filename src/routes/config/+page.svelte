<script lang="ts">
  import { conn } from '$lib/state/connection.svelte';
  import { configState, loadConfig, isDirty, groups } from '$lib/state/config.svelte';
  import { hasConfiguredValues, countConfiguredKeys } from '$lib/utils/config-schema';
  import ConfigSidebar from '$lib/components/config/ConfigSidebar.svelte';
  import ConfigSection from '$lib/components/config/ConfigSection.svelte';
  import ConfigSaveBar from '$lib/components/config/ConfigSaveBar.svelte';
  import * as m from '$lib/paraglide/messages';

  let contentEl = $state<HTMLElement | null>(null);
  let activeGroupId = $state<string | null>(null);
  let expandedIds = $state(new Set<string>());

  $effect(() => {
    if (conn.connected && !configState.loaded && !configState.loading) {
      loadConfig();
    }
    if (!conn.connected && configState.loading) {
      configState.loading = false;
    }
  });

  // Auto-expand configured groups on initial load
  $effect(() => {
    if (configState.loaded && expandedIds.size === 0) {
      const ids = new Set<string>();
      for (const g of groups.value) {
        if (hasConfiguredValues(configState.current[g.fields[0]?.key])) {
          ids.add(g.id);
        }
      }
      // If nothing is configured, expand the first group
      if (ids.size === 0 && groups.value.length > 0) {
        ids.add(groups.value[0].id);
      }
      expandedIds = ids;
    }
  });

  // Sort: configured groups first, then empty, both sub-sorted by order
  const sortedGroups = $derived.by(() => {
    const all = groups.value;
    const configured: typeof all = [];
    const empty: typeof all = [];
    for (const g of all) {
      const val = configState.current[g.fields[0]?.key];
      if (hasConfiguredValues(val)) configured.push(g);
      else empty.push(g);
    }
    return [...configured, ...empty];
  });

  function toggleGroup(groupId: string) {
    const next = new Set(expandedIds);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    expandedIds = next;
  }

  function scrollToGroup(groupId: string) {
    // Expand if collapsed
    if (!expandedIds.has(groupId)) {
      const next = new Set(expandedIds);
      next.add(groupId);
      expandedIds = next;
    }
    activeGroupId = groupId;
    // Scroll after DOM update
    requestAnimationFrame(() => {
      const el = document.getElementById(`config-group-${groupId}`);
      if (el && contentEl) {
        contentEl.scrollTo({ top: el.offsetTop - contentEl.offsetTop - 16, behavior: 'smooth' });
      }
    });
  }

  function configuredCountForGroup(groupId: string): number {
    const g = groups.value.find((x) => x.id === groupId);
    if (!g) return 0;
    const val = configState.current[g.fields[0]?.key];
    return countConfiguredKeys(val);
  }
</script>

<div class="relative z-10 flex flex-col h-screen overflow-hidden text-foreground">
  <!-- Header -->
  <header class="shrink-0 bg-bg/95 backdrop-blur-sm border-b border-border px-4.5 py-2.5 flex items-center">
    <a
      href="/"
      class="text-xs text-muted no-underline px-3 py-1 rounded-full border border-border transition-all duration-150 hover:bg-bg3 hover:text-foreground"
    >
      {m.common_back()}
    </a>
    <span class="ml-auto mr-auto font-bold text-sm text-foreground tracking-wide uppercase">{m.config_fullTitle()}</span>
    <div class="invisible text-xs px-3 py-1">{m.common_back()}</div>
  </header>

  <!-- Body -->
  {#if !conn.connected}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <p class="text-muted-foreground text-sm mb-3">{m.config_noServer()}</p>
        <a href="/" class="text-xs text-accent no-underline hover:underline">{m.config_goToDashboard()}</a>
      </div>
    </div>
  {:else if configState.loading && !configState.loaded}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center">
        <div class="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p class="text-muted-foreground text-xs">{m.config_loading()}</p>
      </div>
    </div>
  {:else if configState.loadError}
    <div class="flex-1 flex items-center justify-center">
      <div class="text-center max-w-sm">
        <p class="text-destructive text-sm mb-2">{m.config_error()}</p>
        <p class="text-muted-foreground text-xs mb-4">{configState.loadError}</p>
        <button
          class="bg-accent border-none rounded-[5px] text-white cursor-pointer font-[inherit] text-xs font-semibold py-[6px] px-4"
          onclick={() => loadConfig()}
        >
          {m.common_retry()}
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
          <div class="max-w-3xl mx-auto space-y-2.5">
            {#if configState.version}
              <p class="text-[10px] text-muted-foreground mb-2">
                Gateway v{configState.version} &middot; {configState.configPath}
              </p>
            {/if}

            {#each sortedGroups as group (group.id)}
              <ConfigSection
                {group}
                expanded={expandedIds.has(group.id)}
                ontoggle={() => toggleGroup(group.id)}
                configuredCount={configuredCountForGroup(group.id)}
              />
            {/each}

            {#if sortedGroups.length === 0}
              <p class="text-muted-foreground text-sm">{m.config_noSections()}</p>
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
