<script lang="ts">
  import type { PageData } from './$types';
  import { goto, invalidate } from '$lib/navigation';
  import { ArrowLeft, Lock, Globe, Trash2 } from 'lucide-svelte';
  import { PageHeader, Button, Tabs } from '$lib/components/ui';
  import PageBody from '$lib/components/ui/foundations/PageBody.svelte';
  import PageShell from '$lib/components/ui/foundations/PageShell.svelte';
  import type { TabItem } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { canAct } from '$lib/access/can.svelte';
  import { createBackNav } from '$lib/nav/back-nav.svelte';
  import { diceBearAvatarUrl } from '$lib/utils/avatar';
  import DocTimeline from '$lib/components/shared/DocTimeline.svelte';
  import BrainDocumentsTable from '$lib/components/brains/BrainDocumentsTable.svelte';
  import BrainOverviewPanel from '$lib/components/brains/BrainOverviewPanel.svelte';
  import BrainKnowledgeSources from '$lib/components/brains/BrainKnowledgeSources.svelte';
  import BrainSearchPanel from '$lib/components/brains/BrainSearchPanel.svelte';
  import BrainAccessPanel from '$lib/components/brains/BrainAccessPanel.svelte';
  import BrainAgentPanel from '$lib/components/brains/BrainAgentPanel.svelte';
  import { jsonMutation, mutationErrorMessage } from '$lib/api/json-mutation';

  let { data }: { data: PageData } = $props();

  const back = createBackNav('/brains', m.brains_detail_back);
  const brain = $derived(data.brain);
  const avatarUrl = $derived(diceBearAvatarUrl(brain.id, 'brain'));

  // Coarse RBAC module gate (canAct) AND the fine per-brain grant
  // (canWriteBrain, resolved server-side by brains.service's canAccessBrain) —
  // both must hold, same as the write API enforces (apiWriteCapability +
  // requireAccess).
  const canEdit = $derived(data.canWriteBrain && canAct('brains', 'edit'));
  const canDelete = $derived(
    brain.kind !== 'master' && data.canWriteBrain && canAct('brains', 'delete'),
  );

  let tab = $state('overview');
  const tabs = $derived<TabItem[]>([
    { value: 'overview', label: m.brains_tab_overview() },
    { value: 'sources', label: m.brains_tab_sources(), count: data.overview.stats.sourceCount },
    { value: 'search', label: m.brains_tab_search() },
    ...(canEdit ? [{ value: 'access', label: m.brains_tab_access() }] : []),
    { value: 'agent', label: m.brains_agent_tab() },
    { value: 'activity', label: m.brains_tab_activity() },
  ]);

  let deleting = $state(false);
  let deleteError = $state<string | null>(null);
  async function deleteBrain() {
    if (!confirm(m.brains_delete_confirm())) return;
    deleting = true;
    deleteError = null;
    try {
      await jsonMutation<{ ok: boolean }>({
        input: `/api/brains/${encodeURIComponent(brain.id)}`,
        init: { method: 'DELETE' },
        onSuccess: () => goto('/brains'),
      });
    } catch (error) {
      deleteError = mutationErrorMessage(error, m.common_error());
    } finally {
      deleting = false;
    }
  }

  async function postComment(body: string) {
    await jsonMutation({
      input: '/api/activity/comments',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refType: 'brain', refId: brain.id, body }),
      },
      onSuccess: () => invalidate('brains:detail'),
    });
  }
</script>

<PageShell archetype="record-detail" scroll="none">
  <PageHeader title={brain.name} subtitle={brain.description ?? undefined}>
    {#snippet leading()}
      <Button variant="ghost" size="sm" shape="icon" onclick={back.go} aria-label={back.label}>
        {#snippet icon()}<ArrowLeft size={15} aria-hidden="true" />{/snippet}
      </Button>
      <img src={avatarUrl} alt="" class="brain-avatar" />
    {/snippet}
    {#snippet secondaryActions()}
      <span class="visibility-chip">
        {#if brain.visibility === 'private'}
          <Lock size={12} aria-hidden="true" /> {m.brains_visibility_private()}
        {:else}
          <Globe size={12} aria-hidden="true" /> {m.brains_visibility_org()}
        {/if}
      </span>
    {/snippet}
    {#snippet primaryActions()}
      {#if canDelete}
        <Button variant="danger" size="sm" loading={deleting} onclick={deleteBrain}>
          {#snippet icon()}<Trash2 size={14} />{/snippet}
          {m.common_delete()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  <PageBody width="content" scroll="region">
    {#if deleteError}
      <p class="mutation-error" role="alert">{deleteError}</p>
    {/if}
    <Tabs id="brain-tabs" aria-label={m.a11y_tabs_brains()} {tabs} bind:value={tab} />

    <div
      class="brain-panel"
      id={`brain-tabs-panel-${tab}`}
      role="tabpanel"
      aria-labelledby={`brain-tabs-tab-${tab}`}
    >
      {#if tab === 'overview'}
        <BrainOverviewPanel overview={data.overview} />
      {:else if tab === 'sources'}
        <div class="sources-stack">
          <BrainKnowledgeSources {brain} sources={data.overview.sources} />
          <section aria-labelledby="added-content-title">
            <div class="legacy-heading">
              <h2 id="added-content-title">{m.brains_legacy_sources()}</h2>
              <p>{m.brains_legacy_sources_desc()}</p>
            </div>
            <BrainDocumentsTable
              brainId={brain.id}
              documents={data.documents}
              canEdit={canEdit && brain.kind !== 'master'}
            />
          </section>
        </div>
      {:else if tab === 'search'}
        <BrainSearchPanel brainId={brain.id} />
      {:else if tab === 'access' && canEdit}
        <BrainAccessPanel
          brainId={brain.id}
          visibility={brain.visibility}
          access={data.access}
          roles={data.roles}
        />
      {:else if tab === 'agent'}
        <BrainAgentPanel
          brainId={brain.id}
          agentId={brain.agentId}
          canManage={canAct('brains', 'manage')}
        />
      {:else if tab === 'activity'}
        <DocTimeline items={data.timeline} onComment={postComment} />
      {/if}
    </div>
  </PageBody>
</PageShell>

<style>
  .brain-avatar {
    width: var(--control-height-sm);
    height: var(--control-height-sm);
    flex: none;
    border: 1px solid var(--color-border-default);
    border-radius: var(--radius-lg);
    background: var(--color-surface-2);
  }

  .visibility-chip {
    display: inline-flex;
    min-height: var(--control-height-sm);
    padding-inline: var(--space-2);
    align-items: center;
    gap: var(--space-1);
    border: 1px solid var(--color-border-subtle);
    border-radius: var(--radius-full);
    color: var(--color-text-secondary);
    background: var(--color-surface-1);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .mutation-error {
    margin-bottom: var(--space-4);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .brain-panel {
    margin-top: var(--space-4);
  }

  .sources-stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-page-section);
  }

  .legacy-heading {
    margin-bottom: var(--space-3);
  }

  .legacy-heading h2 {
    color: var(--color-text-primary);
    font-size: var(--font-size-section-title);
    line-height: var(--line-height-heading);
    font-weight: var(--font-weight-semibold);
  }

  .legacy-heading p {
    margin-top: var(--space-1);
    color: var(--color-text-secondary);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-body);
  }
</style>
