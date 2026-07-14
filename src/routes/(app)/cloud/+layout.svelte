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

<div class="cloud-layout">
  <div class="cloud-nav-desktop">
    <CloudNav canConnect={data.canConnect} canManage={data.canManage} />
  </div>

  <div class="cloud-workspace">
    <CloudHeader canManage={data.canManage} onProvision={() => (provisionOpen = true)} />
    <div class="cloud-nav-compact">
      <CloudNav mode="compact" canConnect={data.canConnect} canManage={data.canManage} />
    </div>
    <div class="cloud-content">
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

<style>
  .cloud-layout,
  .cloud-workspace,
  .cloud-content {
    min-width: 0;
    min-height: 0;
  }

  .cloud-layout {
    display: flex;
    height: 100%;
    background: var(--color-canvas);
  }

  .cloud-nav-desktop {
    flex: none;
    min-height: 0;
  }

  .cloud-workspace {
    display: flex;
    flex: 1;
    flex-direction: column;
    overflow: hidden;
  }

  .cloud-content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .cloud-nav-compact {
    display: none;
    flex: none;
  }

  @media (max-width: 767.98px) {
    .cloud-nav-desktop {
      display: none;
    }

    .cloud-nav-compact {
      display: block;
    }
  }
</style>
