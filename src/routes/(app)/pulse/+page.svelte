<script lang="ts">
  import { onDestroy } from 'svelte';
  import { invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import { Badge, Button, Card, PageHeader } from '$lib/components/ui';
  import { PageShell, PageBody, AsyncBoundary } from '$lib/components/ui/foundations';
  import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';
  import { pulse } from '$lib/state/features/pulse.svelte';
  import type { PulseProposalRow } from '$server/db/pg-schema/pulse';
  import { tryUseActions } from '$lib/services/actions/context';
  import { checkedRefresh } from '$lib/services/actions/refresh';
  import {
    requireOk,
    runCheckedMutation,
    runTrackedCommand,
  } from '$lib/services/actions/mutations';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import * as m from '$lib/paraglide/messages';

  let { data }: { data: { proposals: PulseProposalRow[] } } = $props();

  // Kinds whose payload.args are worth surfacing/editing before approval — the
  // gateway executes them verbatim on approve (see api/pulse/proposals/[id]).
  const EXECUTE_KINDS = new Set(['create_event', 'reminder']);

  let busyId = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let editDraft = $state('');
  let editError = $state<string | null>(null);
  let feedError = $state<string | null>(null);
  let recovery = $state<'unknown' | 'committed-refreshing' | null>(null);
  const refreshPending = $derived(recovery !== null);
  let refreshing = $state(false);
  let refreshActionId: number | undefined;
  let editorGeneration = 0;
  let saveGeneration = 0;
  let disposed = false;
  const actions = tryUseActions();
  let commandScopeVersion = actions?.scopeVersion;

  onDestroy(() => {
    disposed = true;
    editorGeneration += 1;
    saveGeneration += 1;
  });

  $effect(() => {
    const scopeVersion = actions?.scopeVersion;
    if (scopeVersion === commandScopeVersion) return;
    commandScopeVersion = scopeVersion;
    editorGeneration += 1;
    saveGeneration += 1;
    busyId = null;
    editingId = null;
    editDraft = '';
    editError = null;
    feedError = null;
    recovery = null;
    refreshing = false;
    refreshActionId = undefined;
  });

  async function reloadFeed() {
    if (disposed || refreshing || !refreshPending || busyId !== null) return;
    const scopeVersion = actions?.scopeVersion;
    const save = saveGeneration;
    const prior = recovery;
    const current = () =>
      !disposed && save === saveGeneration && actions?.scopeVersion === scopeVersion;
    refreshing = true;
    try {
      await checkedRefresh(
        () => invalidate('pulse:feed'),
        () => page,
      );
      if (!current()) return;
      recovery = null;
      if (prior === 'committed-refreshing') {
        feedError = null;
        if (refreshActionId !== undefined) actions?.reconcile(refreshActionId, 'succeeded');
      }
      // Reload permits a deliberate edit, but is not proof an uncertain write committed.
      refreshActionId = undefined;
    } catch {
      // Preserve the write lock until the current owner can read authoritative data.
    } finally {
      if (current()) refreshing = false;
    }
  }

  async function decide(id: string, action: 'approve' | 'dismiss') {
    if (disposed || busyId !== null || refreshing || refreshPending) return;
    const operation = ++saveGeneration;
    const scopeVersion = actions?.scopeVersion;
    busyId = id;
    try {
      if (action === 'approve') await pulse.approve(id);
      else await pulse.dismiss(id);
      if (!disposed && actions?.scopeVersion === scopeVersion) await invalidate('pulse:feed');
    } finally {
      if (!disposed && operation === saveGeneration && actions?.scopeVersion === scopeVersion)
        busyId = null;
    }
  }

  function startEdit(p: PulseProposalRow) {
    editorGeneration += 1;
    editingId = p.id;
    editDraft = JSON.stringify(p.payload.args ?? {}, null, 2);
    editError = null;
  }

  function cancelEdit() {
    editorGeneration += 1;
    editingId = null;
    editError = null;
  }

  async function saveEdit(id: string) {
    if (disposed || busyId !== null || refreshing || refreshPending) return;
    const submittedEditor = editorGeneration;
    const submittedDraft = editDraft;
    const save = ++saveGeneration;
    const ownsEditor = () =>
      !disposed &&
      editingId === id &&
      editorGeneration === submittedEditor &&
      editDraft === submittedDraft;
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(editDraft) as Record<string, unknown>;
    } catch {
      editError = 'Invalid JSON';
      return;
    }
    editError = null;
    feedError = null;
    busyId = id;
    const scopeVersion = actions?.scopeVersion;
    const current = () =>
      !disposed && save === saveGeneration && actions?.scopeVersion === scopeVersion;
    try {
      const outcome = await runTrackedCommand(actions, 'pulse.proposal.update', (context) => {
        refreshActionId = context?.actionId;
        return runCheckedMutation({
          context,
          attemptId: 'pulse.proposal.update.write',
          mutate: async (signal) => {
            const response = await fetch(`/api/pulse/proposals/${id}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ args }),
              signal,
            });
            await requireOk(response, 'Could not save proposal.');
          },
          onCommitted: () => {
            // Another proposal or a newer draft may now own the visible editor.
            if (!ownsEditor()) return;
            editingId = null;
            editError = null;
          },
          refresh: () =>
            !current()
              ? Promise.resolve()
              : checkedRefresh(
                  () => invalidate('pulse:feed'),
                  () => page,
                ),
          refreshAttemptId: 'pulse.proposal.update.refresh',
        });
      });
      if (!current()) return;
      if (outcome.status === 'succeeded') return;
      const message =
        outcome.status === 'committed-refreshing'
          ? m.asyncAction_refreshing()
          : outcome.status === 'unknown'
            ? m.asyncAction_unknown()
            : outcome.status === 'partial'
              ? m.asyncAction_partial()
              : outcome.error instanceof Error
                ? outcome.error.message
                : 'Could not save proposal.';
      if (
        outcome.status === 'committed-refreshing' ||
        outcome.status === 'unknown' ||
        !ownsEditor()
      ) {
        if (outcome.status === 'committed-refreshing' || outcome.status === 'unknown')
          recovery = outcome.status;
        feedError = message;
        toastError(message);
      } else {
        editError = message;
      }
    } finally {
      if (current()) busyId = null;
    }
  }

  // Existing Pulse page copy remains literal; shared action outcomes use the
  // established Paraglide messages so recovery language stays consistent.
  const pageState = $derived(
    data.proposals.length === 0
      ? ({ kind: 'empty', title: 'Nothing needs your attention.' } as const)
      : ({ kind: 'ready' } as const),
  );
</script>

<PageShell archetype="collection" scroll="region" labelledBy="pulse-page-title">
  <PageHeader
    title="Pulse"
    subtitle="Proposed actions waiting for your review."
    titleId="pulse-page-title"
  />
  <PageBody width="content" scroll="region">
    {#if feedError}<p class="t-caption error" role="alert">{feedError}</p>{/if}
    {#if refreshPending}
      <Button
        variant="secondary"
        size="touch"
        disabled={refreshing || busyId !== null}
        onclick={reloadFeed}
      >
        {m.asyncAction_reload()}
      </Button>
    {/if}
    <AsyncBoundary state={pageState}>
      <div class="cards">
        {#each data.proposals as p (p.id)}
          <Card elevation={2} padding="md">
            {#snippet header()}
              <div class="card-head">
                <h3 class="t-title">{p.title}</h3>
                <div class="badges">
                  <Badge variant="neutral" size="sm">{p.source}</Badge>
                  <Badge variant="neutral" size="sm">{p.kind}</Badge>
                </div>
              </div>
            {/snippet}

            <div class="card-body">
              {#if p.summary}
                <MarkdownMessage value={p.summary} tone="assistant" />
              {/if}

              {#if EXECUTE_KINDS.has(p.kind)}
                <div class="args">
                  {#if editingId === p.id}
                    <label class="t-label" for={`args-${p.id}`}>Arguments</label>
                    <textarea
                      id={`args-${p.id}`}
                      class="args-editor t-mono"
                      rows="6"
                      bind:value={editDraft}></textarea>
                    {#if editError}<p class="t-caption error" role="alert">{editError}</p>{/if}
                    <div class="actions">
                      <Button variant="secondary" size="touch" onclick={cancelEdit}>Cancel</Button>
                      <Button
                        variant="primary"
                        size="touch"
                        loading={busyId === p.id}
                        disabled={busyId !== null || refreshing || refreshPending}
                        onclick={() => saveEdit(p.id)}
                      >
                        Save
                      </Button>
                    </div>
                  {:else}
                    <pre class="args-view t-mono">{JSON.stringify(
                        p.payload.args ?? {},
                        null,
                        2,
                      )}</pre>
                    <Button variant="ghost" size="touch" onclick={() => startEdit(p)}>Edit</Button>
                  {/if}
                </div>
              {/if}
            </div>

            {#snippet footer()}
              <div class="actions">
                <Button
                  variant="secondary"
                  size="touch"
                  loading={busyId === p.id}
                  disabled={busyId !== null || refreshing || refreshPending}
                  onclick={() => decide(p.id, 'dismiss')}
                >
                  Dismiss
                </Button>
                <Button
                  variant="primary"
                  size="touch"
                  loading={busyId === p.id}
                  disabled={busyId !== null || refreshing || refreshPending}
                  onclick={() => decide(p.id, 'approve')}
                >
                  Approve
                </Button>
              </div>
            {/snippet}
          </Card>
        {/each}
      </div>
    </AsyncBoundary>
  </PageBody>
</PageShell>

<style>
  .cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .card-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .badges {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex: none;
  }
  .card-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .args {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .args-view {
    margin: 0;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-1);
    color: var(--color-text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .args-editor {
    padding: var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border-default);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    resize: vertical;
  }
  .args-editor:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
  }
  .error {
    color: var(--color-danger-fg);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
