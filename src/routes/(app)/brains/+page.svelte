<script lang="ts">
  import type { PageData } from './$types';
  import { BookOpen, Plus } from 'lucide-svelte';
  import { PageHeader, Button, iconSizes } from '$lib/components/ui';
  import AsyncBoundary from '$lib/components/ui/foundations/AsyncBoundary.svelte';
  import PageBody from '$lib/components/ui/foundations/PageBody.svelte';
  import PageShell from '$lib/components/ui/foundations/PageShell.svelte';
  import * as m from '$lib/paraglide/messages';
  import { canAct } from '$lib/access/can.svelte';
  import BrainKnowledgeCard from '$lib/components/brains/BrainKnowledgeCard.svelte';
  import BrainCreateDialog from '$lib/components/brains/BrainCreateDialog.svelte';

  let { data }: { data: PageData } = $props();

  let showCreate = $state(false);
  const canCreate = $derived(canAct('brains', 'edit'));
  const masterBrain = $derived(data.brains.find((brain) => brain.kind === 'master'));
  const focusedBrains = $derived(data.brains.filter((brain) => brain.kind !== 'master'));
</script>

<PageShell archetype="collection" scroll="none">
  <PageHeader title={m.brains_page_title()} subtitle={m.brains_page_subtitle()}>
    {#snippet leading()}
      <BookOpen size={iconSizes.md} class="text-accent shrink-0" />
    {/snippet}
    {#snippet primaryActions()}
      {#if canCreate}
        <Button variant="primary" size="sm" onclick={() => (showCreate = true)}>
          {#snippet icon()}<Plus size={iconSizes.sm} />{/snippet}
          {m.brains_create_focused()}
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
            {m.brains_create_focused()}
          </Button>
        {/if}
      {/snippet}
      <div class="brain-sections">
        {#if masterBrain}
          <section aria-labelledby="master-brain-heading">
            <div class="section-heading">
              <div>
                <h2 id="master-brain-heading">{m.brains_section_master()}</h2>
                <p>{m.brains_section_master_desc()}</p>
              </div>
            </div>
            <div class="master-grid">
              <BrainKnowledgeCard brain={masterBrain} />
            </div>
          </section>
        {/if}

        <section aria-labelledby="focused-brains-heading">
          <div class="section-heading section-heading-action">
            <div>
              <h2 id="focused-brains-heading">{m.brains_section_focused()}</h2>
              <p>{m.brains_section_focused_desc()}</p>
            </div>
            {#if canCreate}
              <Button variant="secondary" size="sm" onclick={() => (showCreate = true)}>
                {#snippet icon()}<Plus size={iconSizes.sm} />{/snippet}
                {m.brains_create_focused()}
              </Button>
            {/if}
          </div>

          {#if focusedBrains.length === 0}
            <p class="focused-empty">{m.brains_focused_empty()}</p>
          {:else}
            <div class="brain-grid">
              {#each focusedBrains as brain (brain.id)}
                <BrainKnowledgeCard {brain} />
              {/each}
            </div>
          {/if}
        </section>
      </div>
    </AsyncBoundary>
  </PageBody>
</PageShell>

<BrainCreateDialog bind:open={showCreate} />

<style>
  .brain-sections {
    display: flex;
    flex-direction: column;
    gap: var(--space-page-section);
  }

  .section-heading {
    margin-bottom: var(--space-3);
  }

  .section-heading-action {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .section-heading h2 {
    color: var(--color-text-primary);
    font-size: var(--font-size-section-title);
    line-height: var(--line-height-heading);
    font-weight: var(--font-weight-semibold);
  }

  .section-heading p,
  .focused-empty {
    margin-top: var(--space-1);
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-body);
  }

  .focused-empty {
    padding: var(--space-4);
    border: 1px dashed var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
  }

  .master-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

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
