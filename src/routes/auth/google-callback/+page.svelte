<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authClient } from '$lib/auth-client';
  import { loadUser } from '$lib/state/features/user.svelte';
  import { loadHosts, hostsState } from '$lib/state/features/hosts.svelte';
  import { wsConnect } from '$lib/services/gateway.svelte';
  import { onMount } from 'svelte';

  const redirectTo = $derived((page.url.searchParams.get('redirectTo') ?? '/') || '/');

  onMount(async () => {
    try {
      const orgs = await authClient.organization.list();
      const firstOrg = orgs.data?.[0];
      if (firstOrg) await authClient.organization.setActive({ organizationId: firstOrg.id });
    } catch { /* non-fatal */ }

    await loadUser();
    await loadHosts();
    if (hostsState.activeHostId) wsConnect();
    goto(redirectTo, { replaceState: true });
  });
</script>
