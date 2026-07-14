<script lang="ts">
  import { page } from '$app/state';
  import CloudEmpty from '$lib/components/cloud/CloudEmpty.svelte';
  import RemoteDesktop from '$lib/components/cloud/RemoteDesktop.svelte';
  import { cloudShell, cloudState } from '$lib/state/features/cloud.svelte';
  import * as m from '$lib/paraglide/messages';
  const { data } = $props();
  const selected = $derived(cloudShell(page.url.searchParams.get('server')));
</script>

<svelte:head><title>{m.cloud_gui_title()} · Minion hub</title></svelte:head>

<main class="h-full min-h-0 p-3 bg-black/10">
  {#if cloudState.loading}<div class="grid h-full place-items-center text-xs text-muted">
      {m.common_loading()}
    </div>
  {:else if selected}<div
      class="h-full min-h-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--hairline)] shadow-2xl"
    >
      <RemoteDesktop shell={selected} />
    </div>
  {:else}<CloudEmpty canManage={data.canManage ?? false} />{/if}
</main>
