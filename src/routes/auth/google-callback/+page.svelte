<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authClient } from '$lib/auth-client';
  import { loadUser } from '$lib/state/user.svelte';
  import { onMount } from 'svelte';

  const redirectTo = $derived((page.url.searchParams.get('redirectTo') ?? '/') || '/');

  onMount(async () => {
    try {
      const orgs = await authClient.organization.list();
      const firstOrg = orgs.data?.[0];
      if (firstOrg) await authClient.organization.setActive({ organizationId: firstOrg.id });
    } catch { /* non-fatal */ }

    await loadUser();
    goto(redirectTo, { replaceState: true });
  });
</script>
