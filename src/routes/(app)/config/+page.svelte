<script lang="ts">
  import { Button, PageHeader } from '$lib/components/ui';
  import {
    AsyncBoundary,
    PageBody,
    PageShell,
    type AsyncBoundaryState,
  } from '$lib/components/ui/foundations';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { configState, loadConfig, isDirty, groups } from '$lib/state/config/config.svelte';
  import { hasConfiguredValues, countConfiguredKeys } from '$lib/utils/config-schema';
  import ConfigSidebar from '$lib/components/config/ConfigSidebar.svelte';
  import Splitter from '$lib/components/layout/Splitter.svelte';
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

  const pageState = $derived.by<AsyncBoundaryState>(() => {
    if (!conn.connected) {
      return {
        kind: 'unavailable',
        title: m.config_noServer(),
      };
    }
    if (configState.loading && !configState.loaded) {
      return { kind: 'loading', label: m.config_loading() };
    }
    if (configState.loadError) {
      return {
        kind: 'error',
        title: m.config_error(),
        description: configState.loadError,
        retry: () => void loadConfig(),
      };
    }
    return { kind: 'ready' };
  });
</script>

<PageShell archetype="workspace" scroll="none" labelledBy="config-title">
  <PageHeader titleId="config-title" title={m.config_fullTitle()} sticky={false} />
  <PageBody padding="none" scroll="none">
    <AsyncBoundary state={pageState} class="h-full">
      {#snippet unavailableAction()}
        <Button variant="outline" size="sm" href="/">{m.config_goToDashboard()}</Button>
      {/snippet}
    <Splitter
        storageKey="sidebar-config"
        defaultSize={17}
        minibarSize={5}
        maxSize={26}
    >
        {#snippet panel({ collapseLevel })}
            <ConfigSidebar {activeGroupId} onselect={scrollToGroup} {collapseLevel} />
        {/snippet}
        <div class="flex-1 flex flex-col min-h-0">
          <div bind:this={contentEl} class="flex-1 overflow-y-auto px-6 py-5">
            <div class="max-w-3xl mx-auto space-y-2.5">
              {#if configState.version}
                <p class="text-xs text-muted-foreground mb-2">
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
    </Splitter>
    </AsyncBoundary>
  </PageBody>
</PageShell>
