<script lang="ts">
  import type { PageData } from './$types';
  import { BookOpen, Plus } from 'lucide-svelte';
  import { PageHeader, Button, EmptyState } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { canAct } from '$lib/access/can.svelte';
  import BrainCard from '$lib/components/brains/BrainCard.svelte';
  import BrainCreateDialog from '$lib/components/brains/BrainCreateDialog.svelte';

  let { data }: { data: PageData } = $props();

  let showCreate = $state(false);
  const canCreate = $derived(canAct('brains', 'edit'));
</script>

<div class="flex h-full flex-col overflow-hidden">
  <PageHeader title={m.brains_page_title()} subtitle={m.brains_page_subtitle()}>
    {#snippet leading()}
      <BookOpen size={16} class="text-accent shrink-0" />
    {/snippet}
    {#snippet actions()}
      {#if canCreate}
        <Button variant="primary" size="sm" onclick={() => (showCreate = true)}>
          {#snippet icon()}<Plus size={14} />{/snippet}
          {m.brains_create()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-y-auto p-6">
    {#if data.brains.length === 0}
      <EmptyState
        title={m.brains_empty_title()}
        description={m.brains_empty_desc()}
        icon={BookOpen}
      >
        {#snippet action()}
          {#if canCreate}
            <Button variant="secondary" size="sm" onclick={() => (showCreate = true)}>{m.brains_create()}</Button>
          {/if}
        {/snippet}
      </EmptyState>
    {:else}
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {#each data.brains as brain (brain.id)}
          <BrainCard {brain} />
        {/each}
      </div>
    {/if}
  </div>
</div>

<BrainCreateDialog bind:open={showCreate} />
