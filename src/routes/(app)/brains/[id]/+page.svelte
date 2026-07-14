<script lang="ts">
  import type { PageData } from './$types';
  import { goto, invalidate } from '$app/navigation';
  import { ArrowLeft, Lock, Globe, Trash2 } from 'lucide-svelte';
  import { PageHeader, Button, Tabs } from '$lib/components/ui';
  import type { TabItem } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { canAct } from '$lib/access/can.svelte';
  import { createBackNav } from '$lib/nav/back-nav.svelte';
  import { diceBearAvatarUrl } from '$lib/utils/avatar';
  import DocTimeline from '$lib/components/shared/DocTimeline.svelte';
  import BrainDocumentsTable from '$lib/components/brains/BrainDocumentsTable.svelte';
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
  const canDelete = $derived(data.canWriteBrain && canAct('brains', 'delete'));

  let tab = $state('documents');
  const tabs = $derived<TabItem[]>([
    { value: 'documents', label: m.brains_tab_documents(), count: data.documents.length },
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

<div class="flex h-full flex-col overflow-hidden">
  <PageHeader title={brain.name} subtitle={brain.description ?? undefined}>
    {#snippet leading()}
      <button type="button" onclick={back.go} class="grid size-7 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.06] hover:text-white" aria-label={back.label}>
        <ArrowLeft size={15} />
      </button>
      <img src={avatarUrl} alt="" class="size-7 shrink-0 rounded-lg bg-white/5 ring-1 ring-white/10" />
    {/snippet}
    {#snippet actions()}
      <span class="inline-flex items-center gap-1 text-[11px] text-white/45">
        {#if brain.visibility === 'private'}
          <Lock size={11} /> {m.brains_visibility_private()}
        {:else}
          <Globe size={11} /> {m.brains_visibility_org()}
        {/if}
      </span>
      {#if canDelete}
        <Button variant="danger" size="sm" loading={deleting} onclick={deleteBrain}>
          {#snippet icon()}<Trash2 size={14} />{/snippet}
          {m.common_delete()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-y-auto p-6">
    {#if deleteError}
      <p class="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{deleteError}</p>
    {/if}
    <Tabs id="brain-tabs" aria-label={m.a11y_tabs_brains()} {tabs} bind:value={tab} class="mb-4" />

    <div id={`brain-tabs-panel-${tab}`} role="tabpanel" aria-labelledby={`brain-tabs-tab-${tab}`}>
    {#if tab === 'documents'}
      <BrainDocumentsTable brainId={brain.id} documents={data.documents} {canEdit} />
    {:else if tab === 'search'}
      <BrainSearchPanel brainId={brain.id} />
    {:else if tab === 'access' && canEdit}
      <BrainAccessPanel brainId={brain.id} visibility={brain.visibility} access={data.access} roles={data.roles} />
    {:else if tab === 'agent'}
      <BrainAgentPanel brainId={brain.id} agentId={brain.agentId} canManage={canAct('brains', 'manage')} />
    {:else if tab === 'activity'}
      <DocTimeline items={data.timeline} onComment={postComment} />
    {/if}
    </div>
  </div>
</div>
