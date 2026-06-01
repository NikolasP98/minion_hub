<script lang="ts">
  import TeamTab from '$lib/components/users/TeamTab.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<TeamTab
  initialUsers={data.users}
  initialCustomRoles={data.customRoles}
  initialPendingRequests={data.pendingRequests}
  organizations={data.organizations}
/>
