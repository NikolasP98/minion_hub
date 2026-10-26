<script lang="ts">
  import type { PageData } from './$types';
  import { DoorOpen } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { iconSizes } from '$lib/components/ui';
  import { PublicTaskShell } from '$lib/components/ui/foundations';
  import { getDoorPublic } from '$lib/components/doors/registry';

  let { data }: { data: PageData } = $props();

  // Each kind renders through its own Public.svelte (spec 041 registry).
  const Public = $derived(getDoorPublic(data.kind));
</script>

<svelte:head>
  <title>{data.door.title}</title>
  {#if data.kind !== 'faq'}
    <meta name="robots" content="noindex" />
  {/if}
</svelte:head>

{#snippet taskIcon()}
  <DoorOpen size={iconSizes.lg} />
{/snippet}

<PublicTaskShell
  eyebrow={data.orgName ?? ''}
  title={data.door.title}
  description={data.door.description ?? undefined}
  icon={taskIcon}
  size="medium"
>
  {#if Public}
    <Public door={data.door} data={data.data} attribution={data.attribution} />
  {:else}
    <p class="t-body unavailable">{m.doors_public_unavailable()}</p>
  {/if}
</PublicTaskShell>

<style>
  .unavailable {
    color: var(--color-text-secondary);
  }
</style>
