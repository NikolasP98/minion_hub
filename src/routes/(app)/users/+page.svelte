<script lang="ts">
  import TeamTab from '$lib/components/users/TeamTab.svelte';
  import BindingsTab from '$lib/components/users/BindingsTab.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { configState, loadConfig } from '$lib/state/config/config.svelte';
  import * as m from '$lib/paraglide/messages';
  import { PageHeader, Tabs, type TabItem } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';

  type Tab = 'team' | 'bindings';
  let activeTab = $state<Tab>('team');
  const tabs: TabItem[] = $derived([
    { value: 'team', label: m.users_team() },
    { value: 'bindings', label: m.users_bindings() },
  ]);

  // Load gateway config when switching to bindings tab (if not already loaded)
  $effect(() => {
    if (activeTab === 'bindings' && conn.connected && !configState.loaded && !configState.loading) {
      loadConfig();
    }
  });
</script>

<PageShell archetype="collection" scroll="page" labelledBy="users-title">
  <PageHeader
    titleId="users-title"
    title={m.users_title()}
    subtitle="Manage team members and channel identity bindings"
  />
  <PageBody width="content" padding="compact">
    <div class="users-body">
      <Tabs
        id="users-tabs"
        aria-label={m.users_title()}
        {tabs}
        value={activeTab}
        onValueChange={(value) => (activeTab = value as Tab)}
      />
      <div
        id={`users-tabs-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`users-tabs-tab-${activeTab}`}
        class="users-panel"
      >
        {#if activeTab === 'team'}
          <TeamTab />
        {:else}
          <BindingsTab />
        {/if}
      </div>
    </div>
  </PageBody>
</PageShell>

<style>
  .users-body {
    display: flex;
    flex-direction: column;
  }
  .users-panel {
    min-width: 0;
    padding-top: var(--space-3, 12px);
  }
</style>
