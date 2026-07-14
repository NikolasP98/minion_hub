<script lang="ts">
  // Dedicated Team page (Organization → Team). Surfaces member management —
  // invites, roles, seats — reusing the same TeamTab the legacy /users route
  // hosts. Access is gated in the sidebar by `users.manage`; the underlying
  // /api/users endpoints enforce authorization server-side.
  import TeamTab from '$lib/components/users/TeamTab.svelte';
  import SharedAccountsPanel from '$lib/components/users/SharedAccountsPanel.svelte';
  import { PageHeader } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
</script>

<svelte:head>
  <title>Team · Minion</title>
</svelte:head>

<PageShell archetype="collection" scroll="page" labelledBy="team-title">
  <PageHeader
    titleId="team-title"
    title="Team"
    subtitle="Members, roles, invitations, and shared accounts"
  />
  <PageBody width="content">
    <div class="team-stack">
      <TeamTab />
      <SharedAccountsPanel />
    </div>
  </PageBody>
</PageShell>

<style>
  .team-stack {
    display: grid;
    align-content: start;
    gap: var(--space-section, 24px);
  }
</style>
