<script lang="ts">
  import type { Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import { onMount, untrack } from 'svelte';
  import CloudHeader from '$lib/components/cloud/CloudHeader.svelte';
  import CloudNav from '$lib/components/cloud/CloudNav.svelte';
  import ProvisionWorkspaceDialog from '$lib/components/cloud/ProvisionWorkspaceDialog.svelte';
  import { conn } from '$lib/state/gateway';
  import { loadHosts } from '$lib/state/features/hosts.svelte';
  import { refreshCloud, setCloudOrg } from '$lib/state/features/cloud.svelte';
  import type { ShellsProvisionResponse } from '$lib/services/shells-rpc';

  let {
    data,
    children,
  }: {
    data: { canConnect: boolean; canManage: boolean; cloudOrgId: string | null };
    children: Snippet;
  } = $props();
  let provisionOpen = $state(false);

  $effect(() => {
    setCloudOrg(data.cloudOrgId);
  });

  $effect(() => {
    // refreshCloud mutates rune-backed loading state synchronously. Keep those
    // mutations outside this effect's dependency graph so a completed refresh
    // cannot retrigger itself forever.
    if (conn.connected) untrack(() => void refreshCloud());
  });

  onMount(() => {
    loadHosts();
    if (conn.connected) void refreshCloud();
    const id = window.setInterval(() => {
      if (conn.connected) void refreshCloud({ background: true });
    }, 10_000);
    return () => window.clearInterval(id);
  });

  async function provisioned(result: ShellsProvisionResponse): Promise<void> {
    provisionOpen = false;
    await refreshCloud();
    await goto(`/cloud?server=${encodeURIComponent(result.shellId)}`);
  }
</script>

<div class="h-full min-h-0 flex">
  <CloudNav canConnect={data.canConnect} canManage={data.canManage} />
  <div class="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
    <CloudHeader canManage={data.canManage} onProvision={() => (provisionOpen = true)} />
    <div class="flex-1 min-h-0 overflow-hidden">
      {@render children()}
    </div>
  </div>
</div>

{#if provisionOpen}
  <ProvisionWorkspaceDialog
    onClose={() => (provisionOpen = false)}
    onProvisioned={(result) => void provisioned(result)}
  />
{/if}
