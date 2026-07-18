<script lang="ts">
  import { invalidate } from '$app/navigation';
  import { Badge, Button, Card, PageHeader } from '$lib/components/ui';
  import { PageShell, PageBody, AsyncBoundary } from '$lib/components/ui/foundations';
  import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';
  import { pulse } from '$lib/state/features/pulse.svelte';
  import type { PulseProposalRow } from '$server/db/pg-schema/pulse';

  let { data }: { data: { proposals: PulseProposalRow[] } } = $props();

  // Kinds whose payload.args are worth surfacing/editing before approval — the
  // gateway executes them verbatim on approve (see api/pulse/proposals/[id]).
  const EXECUTE_KINDS = new Set(['create_event', 'reminder']);

  let busyId = $state<string | null>(null);
  let editingId = $state<string | null>(null);
  let editDraft = $state('');
  let editError = $state<string | null>(null);

  async function decide(id: string, action: 'approve' | 'dismiss') {
    busyId = id;
    try {
      if (action === 'approve') await pulse.approve(id);
      else await pulse.dismiss(id);
      await invalidate('pulse:feed');
    } finally {
      busyId = null;
    }
  }

  function startEdit(p: PulseProposalRow) {
    editingId = p.id;
    editDraft = JSON.stringify(p.payload.args ?? {}, null, 2);
    editError = null;
  }

  function cancelEdit() {
    editingId = null;
    editError = null;
  }

  async function saveEdit(id: string) {
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(editDraft) as Record<string, unknown>;
    } catch {
      editError = 'Invalid JSON';
      return;
    }
    editError = null;
    busyId = id;
    try {
      await fetch(`/api/pulse/proposals/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ args }),
      });
      editingId = null;
      await invalidate('pulse:feed');
    } finally {
      busyId = null;
    }
  }

  // ponytail: literal English copy for slice 1 — this page skips Paraglide to
  // avoid touching the shared messages/en.json + es.json (another agent had an
  // uncommitted concurrent edit there). Follow-up: add pulse_* keys + i18n:compile
  // when the swarm's parallel edits to those files settle.
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
                      bind:value={editDraft}
                    ></textarea>
                    {#if editError}<p class="t-caption error">{editError}</p>{/if}
                    <div class="actions">
                      <Button variant="secondary" size="sm" onclick={cancelEdit}>Cancel</Button>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={busyId === p.id}
                        onclick={() => saveEdit(p.id)}
                      >
                        Save
                      </Button>
                    </div>
                  {:else}
                    <pre class="args-view t-mono">{JSON.stringify(p.payload.args ?? {}, null, 2)}</pre>
                    <Button variant="ghost" size="sm" onclick={() => startEdit(p)}>Edit</Button>
                  {/if}
                </div>
              {/if}
            </div>

            {#snippet footer()}
              <div class="actions">
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busyId === p.id}
                  onclick={() => decide(p.id, 'dismiss')}
                >
                  Dismiss
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busyId === p.id}
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
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
