<script lang="ts">
  import type { PageData } from './$types';
  import { BookOpen, Plus } from 'lucide-svelte';
  import { PageHeader, Button } from '$lib/components/ui';
  import AsyncBoundary from '$lib/components/ui/foundations/AsyncBoundary.svelte';
  import PageBody from '$lib/components/ui/foundations/PageBody.svelte';
  import PageShell from '$lib/components/ui/foundations/PageShell.svelte';
  import * as m from '$lib/paraglide/messages';
  import { canAct } from '$lib/access/can.svelte';
  import BrainCard from '$lib/components/brains/BrainCard.svelte';
  import BrainCreateDialog from '$lib/components/brains/BrainCreateDialog.svelte';

  let { data }: { data: PageData } = $props();

  let showCreate = $state(false);
  const canCreate = $derived(canAct('brains', 'edit'));
</script>

<PageShell archetype="collection" scroll="none">
  <PageHeader title={m.brains_page_title()} subtitle={m.brains_page_subtitle()}>
    {#snippet leading()}
      <BookOpen size={16} class="text-accent shrink-0" />
    {/snippet}
    {#snippet primaryActions()}
      {#if canCreate}
        <Button variant="primary" size="sm" onclick={() => (showCreate = true)}>
          {#snippet icon()}<Plus size={14} />{/snippet}
          {m.brains_create()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  <PageBody width="content" scroll="region">
    <AsyncBoundary
      state={data.brains.length === 0
        ? { kind: 'empty', title: m.brains_empty_title(), description: m.brains_empty_desc() }
        : { kind: 'ready' }}
    >
      {#snippet emptyAction()}
        {#if canCreate}
          <Button variant="secondary" size="sm" onclick={() => (showCreate = true)}>
            {m.brains_create()}
          </Button>
        {/if}
      {/snippet}
      <div class="brain-grid">
        {#each data.brains as brain (brain.id)}
          <BrainCard {brain} />
        {/each}
      </div>
    </AsyncBoundary>
  </PageBody>
</PageShell>

<BrainCreateDialog bind:open={showCreate} />

<style>
  .brain-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }

  @media (max-width: 1279.98px) {
    .brain-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 767.98px) {
    .brain-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
