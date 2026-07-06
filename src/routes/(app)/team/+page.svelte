<script lang="ts">
  // Dedicated Team page (Organization → Team). Surfaces member management —
  // invites, roles, seats — reusing the same TeamTab the legacy /users route
  // hosts. Access is gated in the sidebar by `users.manage`; the underlying
  // /api/users endpoints enforce authorization server-side.
  import TeamTab from '$lib/components/users/TeamTab.svelte';
  import SharedAccountsPanel from '$lib/components/users/SharedAccountsPanel.svelte';
</script>

<svelte:head>
  <title>Team · Minion</title>
</svelte:head>

<div class="h-full flex flex-col overflow-y-auto">
  <TeamTab />
  <SharedAccountsPanel />
</div>
