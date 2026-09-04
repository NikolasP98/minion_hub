<script lang="ts">
  import TeamTab from '$lib/components/users/TeamTab.svelte';
  import SharedAccountsPanel from '$lib/components/users/SharedAccountsPanel.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<!-- Page owns scroll so TeamTab + shared accounts stack as one scrollable column. -->
<div class="flex-1 min-h-0 overflow-y-auto">
  <TeamTab
    initialUsers={data.users}
    rbacRoles={data.rbacRoles}
    initialPendingRequests={data.pendingRequests}
    organizations={data.organizations}
  />
  <div class="px-6 pb-6">
    <SharedAccountsPanel />
  </div>
</div>
