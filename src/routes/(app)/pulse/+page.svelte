<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import { Badge, Button, Card, PageHeader } from '$lib/components/ui';
  import { PageShell, PageBody, AsyncBoundary } from '$lib/components/ui/foundations';
  import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { pulse } from '$lib/state/features/pulse.svelte';
  import type { PulseProposalView } from '$server/services/pulse.service';
  import type { PulseReceipt as Receipt } from '$server/services/pulse-dispatch.store';
  import PulseReceipt from '$lib/components/pulse/PulseReceipt.svelte';
  import PulseFeedback from '$lib/components/pulse/PulseFeedback.svelte';
  import PulseDigestEvidence from '$lib/components/pulse/PulseDigestEvidence.svelte';
  import { canAct } from '$lib/access/can.svelte';
  import { tryUseActions } from '$lib/services/actions/context';
  import { checkedRefresh } from '$lib/services/actions/refresh';
  import {
    requireOk,
    runCheckedMutation,
    runTrackedCommand,
  } from '$lib/services/actions/mutations';
  import { toastError } from '$lib/state/ui/toast.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    data,
  }: { data: { proposals: PulseProposalView[]; recent?: (Receipt & { title: string })[] } } =
    $props();

  // Executable proposals expose typed arguments for review. Approval queues a
  // frozen dispatch; its remote scheduling receipt remains distinct from execution.
  const EXECUTE_KINDS = new Set(['create_event', 'reminder']);

  let busyId = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let editingRevision = $state<number | null>(null);
  let editDraft = $state('');
  let editError = $state<string | null>(null);
  let feedError = $state<string | null>(null);
  let recovery = $state<'unknown' | 'committed-refreshing' | 'conflict' | null>(null);
  const refreshPending = $derived(recovery !== null);
  let refreshing = $state(false);
  let refreshActionId: number | undefined;
  let editorGeneration = 0;
  let saveGeneration = 0;
  let disposed = false;
  const actions = tryUseActions();
  $effect(() => {
    pulse.syncScope(actions?.scopeVersion);
  });
  $effect(() => {
    if (conn.connectedAt)
      untrack(
        () =>
          void pulse.recover(() =>
            checkedRefresh(
              () => invalidate('pulse:feed'),
              () => page,
            ),
          ),
      );
  });
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
      if (editingId) {
        const currentProposal = data.proposals.find((proposal) => proposal.id === editingId);
        if (currentProposal) editingRevision = currentProposal.revision;
      }
      if (prior === 'committed-refreshing' || prior === 'conflict') {
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

  async function decide(id: string, revision: number, action: 'approve' | 'dismiss') {
    if (disposed || busyId !== null || refreshing || refreshPending || pulse.recovery) return;
    busyId = id;
    try {
      const options = {
        actions,
        refresh: () =>
          checkedRefresh(
            () => invalidate('pulse:feed'),
            () => page,
          ),
      };
      if (action === 'approve') await pulse.approve(id, revision, options);
      else await pulse.dismiss(id, revision, options);
    } finally {
      if (!disposed) busyId = null;
    }
  }

  function startEdit(p: PulseProposalView) {
    editorGeneration += 1;
    editingId = p.id;
    editingRevision = p.revision;
    editDraft = JSON.stringify(p.payload.args ?? {}, null, 2);
    editError = null;
  }

  function cancelEdit() {
    editorGeneration += 1;
    editingId = null;
    editError = null;
  }

  async function saveEdit(id: string) {
    const expectedRevision = editingRevision;
    if (expectedRevision === null) return;
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
      editError = m.pulse_invalidJson();
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
              body: JSON.stringify({ args, expectedRevision }),
              signal,
            });
            await requireOk(response, m.pulse_decisionFailed());
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
            : outcome.status === 'conflict'
              ? m.pulse_refreshRequired()
              : outcome.status === 'partial'
                ? m.asyncAction_partial()
                : m.pulse_decisionFailed();
      if (
        outcome.status === 'committed-refreshing' ||
        outcome.status === 'unknown' ||
        outcome.status === 'conflict' ||
        !ownsEditor()
      ) {
        if (
          outcome.status === 'committed-refreshing' ||
          outcome.status === 'unknown' ||
          outcome.status === 'conflict'
        )
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

  const pageState = $derived(
    data.proposals.length === 0
      ? ({ kind: 'empty', title: m.pulse_empty() } as const)
      : ({ kind: 'ready' } as const),
  );
</script>

<PageShell archetype="collection" scroll="region" labelledBy="pulse-page-title">
  <PageHeader title="Pulse" subtitle={m.pulse_pageSubtitle()} titleId="pulse-page-title" />
  <PageBody width="content" scroll="region">
    {#if pulse.error}<p class="t-caption error" role="alert">{pulse.error}</p>{/if}
    {#if pulse.recovery}<Button
        variant="secondary"
        loading={pulse.busy}
        onclick={() =>
          pulse.recover(() =>
            checkedRefresh(
              () => invalidate('pulse:feed'),
              () => page,
            ),
          )}>{m.asyncAction_reload()}</Button
      >{/if}
    {#each pulse.receipts as receipt (receipt.proposalId)}<PulseReceipt {receipt} />{/each}
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
    {#if canAct('pulse', 'export')}
      <Button href="/api/pulse/feedback/export" variant="secondary" size="touch"
        >{m.pulse_feedbackExport()}</Button
      >
    {/if}
    <AsyncBoundary state={pageState}>
      <div class="cards">
        {#each data.proposals as p (p.id)}
          <Card elevation={2} padding="md">
            {#snippet header()}
              <div class="card-head">
                <h3 class="t-title">{p.title}</h3>
                <span class="t-caption">{m.pulse_revision({ revision: p.revision })}</span>
                <div class="badges">
                  <Badge variant="neutral" size="sm">{p.source}</Badge>
                  <Badge variant="neutral" size="sm">{p.kind}</Badge>
                </div>
              </div>
            {/snippet}

            <div class="card-body">
              {#if p.summary}
                {#if p.source === 'dependency-digest'}<p class="t-body">
                    {p.summary}
                  </p>{:else}<MarkdownMessage value={p.summary} tone="assistant" />{/if}
              {/if}
              {#if p.source === 'dependency-digest' && p.ownerProfileId}
                <PulseDigestEvidence payload={p.payload} />
                <PulseFeedback proposalId={p.id} revision={p.revision} />
              {/if}

              {#if EXECUTE_KINDS.has(p.kind)}
                <div class="args">
                  {#if editingId === p.id}
                    <label class="t-label" for={`args-${p.id}`}>{m.pulse_arguments()}</label>
                    <textarea
                      id={`args-${p.id}`}
                      class="args-editor t-mono"
                      rows="6"
                      bind:value={editDraft}></textarea>
                    {#if editError}<p class="t-caption error" role="alert">{editError}</p>{/if}
                    <div class="actions">
                      <Button variant="secondary" size="touch" onclick={cancelEdit}
                        >{m.pulse_cancel()}</Button
                      >
                      <Button
                        variant="primary"
                        size="touch"
                        loading={busyId === p.id}
                        disabled={busyId !== null ||
                          refreshing ||
                          refreshPending ||
                          pulse.recovery !== null ||
                          pulse.receipt(p.id) !== undefined}
                        onclick={() => saveEdit(p.id)}
                      >
                        {m.pulse_save()}
                      </Button>
                    </div>
                  {:else}
                    <pre class="args-view t-mono">{JSON.stringify(
                        p.payload.args ?? {},
                        null,
                        2,
                      )}</pre>
                    <Button variant="ghost" size="touch" onclick={() => startEdit(p)}
                      >{m.pulse_edit()}</Button
                    >
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
                  disabled={busyId !== null ||
                    refreshing ||
                    refreshPending ||
                    pulse.recovery !== null ||
                    pulse.receipt(p.id) !== undefined}
                  onclick={() => decide(p.id, p.revision, 'dismiss')}
                >
                  {m.pulse_dismiss()}
                </Button>
                <Button
                  variant="primary"
                  size="touch"
                  loading={busyId === p.id}
                  disabled={busyId !== null ||
                    refreshing ||
                    refreshPending ||
                    pulse.recovery !== null ||
                    pulse.receipt(p.id) !== undefined}
                  onclick={() => decide(p.id, p.revision, 'approve')}
                >
                  {m.pulse_approve()}
                </Button>
              </div>
            {/snippet}
          </Card>
        {/each}
      </div>
    </AsyncBoundary>
    {#if data.recent?.length}
      <section aria-label={m.pulse_recent()}>
        <h2 class="t-title">{m.pulse_recent()}</h2>
        {#each data.recent as receipt (receipt.proposalId)}
          <Card padding="md"
            ><p class="t-body">{receipt.title}</p>
            <PulseReceipt {receipt} /></Card
          >
        {/each}
      </section>
    {/if}
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
