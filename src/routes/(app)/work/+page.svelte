<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { PageHeader, Button, Badge, Select, Tabs } from '$lib/components/ui';
  import { AsyncBoundary, PageBody, PageShell } from '$lib/components/ui/foundations';
  import type { TabItem } from '$lib/components/ui';
  import { Factory, Radio } from 'lucide-svelte';
  import { onMount } from 'svelte';
  import { startPolling } from '$lib/utils/live-polling';
  import type { WorkforceWorkItem } from '$lib/workforce/work-queue';
  import * as m from '$lib/paraglide/messages';
  import { jsonMutation, mutationErrorMessage } from '$lib/api/json-mutation';

  let { data }: { data: PageData } = $props();

  const DOC_LABEL: Record<string, string> = {
    support_issue: 'Ticket',
    crm_contact: 'Lead',
    sales_order: 'Order',
    workforce_hitl: 'Factory gate',
  };

  onMount(() => startPolling('work:queue', 6000));

  let tab = $state('queue');
  let mutationError = $state<string | null>(null);
  const tabs: TabItem[] = $derived([
    { value: 'queue', label: 'My Queue', count: data.items.length },
    ...(data.isAdmin ? [{ value: 'rules', label: 'Rules' }] : []),
  ]);

  // ── Reassign ────────────────────────────────────────────────────────────────
  async function reassign(docType: string, docId: string, newOwner: string) {
    mutationError = null;
    try {
      await jsonMutation({
        input: '/api/work/reassign',
        init: {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ docType, docId, newOwner: newOwner || null }),
        },
        onSuccess: () => invalidate('work:queue'),
      });
    } catch (error) {
      mutationError = mutationErrorMessage(error, m.common_error());
    }
  }

  // ── Rules (admin) ─────────────────────────────────────────────────────────────
  let newName = $state('');
  let newDocType = $state('support_issue');
  let newStrategy = $state('round_robin');
  let newAssignees = $state<string[]>([]);
  let busy = $state(false);

  function memberName(id: string) {
    return data.members.find((m) => m.id === id)?.name ?? id;
  }

  function factoryItem(item: PageData['items'][number]): WorkforceWorkItem | null {
    return item.docType === 'workforce_hitl' ? (item as WorkforceWorkItem) : null;
  }

  async function createRule() {
    if (!newName.trim() || newAssignees.length === 0) return;
    busy = true;
    mutationError = null;
    try {
      await jsonMutation({
        input: '/api/assignment/rules',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: newName.trim(),
            docType: newDocType,
            strategy: newStrategy,
            assignees: newAssignees,
          }),
        },
        onSuccess: async () => {
          newName = '';
          newAssignees = [];
          await invalidate('work:queue');
        },
      });
    } catch (error) {
      mutationError = mutationErrorMessage(error, m.common_error());
    } finally {
      busy = false;
    }
  }

  async function toggleRule(id: string, enabled: boolean) {
    mutationError = null;
    try {
      await jsonMutation({
        input: `/api/assignment/rules/${id}`,
        init: {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled }),
        },
        onSuccess: () => invalidate('work:queue'),
      });
    } catch (error) {
      mutationError = mutationErrorMessage(error, m.common_error());
    }
  }

  async function deleteRule(id: string) {
    mutationError = null;
    try {
      await jsonMutation({
        input: `/api/assignment/rules/${id}`,
        init: { method: 'DELETE' },
        onSuccess: () => invalidate('work:queue'),
      });
    } catch (error) {
      mutationError = mutationErrorMessage(error, m.common_error());
    }
  }

  function toggleAssignee(id: string) {
    newAssignees = newAssignees.includes(id)
      ? newAssignees.filter((a) => a !== id)
      : [...newAssignees, id];
  }
</script>

<PageShell archetype="collection" scroll="page" labelledBy="work-title">
  <PageHeader
    titleId="work-title"
    title="Work"
    subtitle="One queue for operational work and human factory gates"
  />

  <PageBody padding="compact">
    <Tabs id="work-tabs" aria-label={m.a11y_tabs_work()} {tabs} bind:value={tab} />

    {#if mutationError}
      <p
        class="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        role="alert"
      >
        {mutationError}
      </p>
    {/if}

    <div id={`work-tabs-panel-${tab}`} role="tabpanel" aria-labelledby={`work-tabs-tab-${tab}`}>
      {#if tab === 'queue'}
        {#if data.items.length === 0}
          <AsyncBoundary
            state={{
              kind: 'empty',
              title: 'Nothing on your plate',
              description: 'Assigned records and production-line decisions will show up here.',
            }}
            compact
          />
        {:else}
          <div class="queue">
            {#each data.items as it (it.docType + it.id)}
              {@const factory = factoryItem(it)}
              <div class:factory-row={!!factory} class="row">
                <Badge>
                  {#if factory}<Factory size={12} />{/if}
                  {DOC_LABEL[it.docType] ?? it.docType}
                </Badge>
                <div class="work-copy">
                  <a class="title" href={it.href}
                    >{it.humanId ? `${it.humanId} · ` : ''}{it.title}</a
                  >
                  {#if factory}
                    <span class="factory-meta"
                      >{factory.pipelineName} · {factory.stageLabel}{factory.assignmentKind ===
                      'role'
                        ? ` · ${factory.assignmentRoleKeys.join(', ')}`
                        : ' · assigned to you'}</span
                    >
                  {/if}
                </div>
                {#if it.status}<span class="status">{it.status.replaceAll('_', ' ')}</span>{/if}
                <div class="spacer"></div>
                {#if factory}
                  <a class="open-gate" href={it.href}>Open gate →</a>
                {:else}
                  <Select
                    size="sm"
                    value=""
                    onchange={(v) => reassign(it.docType, it.id, String(v))}
                  >
                    <option value="">Reassign…</option>
                    {#each data.members as m (m.id)}
                      <option value={m.id}>{m.name}</option>
                    {/each}
                  </Select>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
        {#if !data.workforceQueueAvailable}
          <p class="factory-offline">
            <Radio size={12} /> Factory gates are temporarily offline; your other work remains available.
          </p>
        {/if}
      {:else if tab === 'rules'}
        <div class="rules">
          <p class="muted small">
            <a href="/settings/workflows">Configure workflows →</a> (role-gated state machines for tickets
            & orders)
          </p>
          <p class="muted small">
            <a href="/settings/notifications">Configure notification rules →</a> (alert someone when a
            record changes)
          </p>
          <div class="card new-rule">
            <h3>New rule</h3>
            <input class="inp" placeholder="Rule name" bind:value={newName} />
            <div class="grid">
              <label
                >Doc type
                <Select size="sm" bind:value={newDocType}>
                  {#each data.docTypes as dt (dt)}<option value={dt}>{DOC_LABEL[dt] ?? dt}</option
                    >{/each}
                </Select>
              </label>
              <label
                >Strategy
                <Select size="sm" bind:value={newStrategy}>
                  <option value="round_robin">Round-robin</option>
                  <option value="least_open">Least open</option>
                </Select>
              </label>
            </div>
            <div class="assignees">
              <span class="lbl">Assignees</span>
              {#each data.members as m (m.id)}
                <Button
                  size="sm"
                  variant={newAssignees.includes(m.id) ? 'secondary' : 'outline'}
                  class="chip"
                  aria-pressed={newAssignees.includes(m.id)}
                  onclick={() => toggleAssignee(m.id)}
                >
                  {m.name}
                </Button>
              {/each}
            </div>
            <Button
              onclick={createRule}
              disabled={busy || !newName.trim() || newAssignees.length === 0}>Create rule</Button
            >
          </div>

          {#each data.rules as r (r.id)}
            <div class="card rule">
              <div class="rule-head">
                <strong>{r.name}</strong>
                <Badge>{DOC_LABEL[r.docType] ?? r.docType}</Badge>
                <span class="muted"
                  >{r.strategy === 'least_open' ? 'least open' : 'round-robin'}</span
                >
                <div class="spacer"></div>
                <Button size="sm" variant="secondary" onclick={() => toggleRule(r.id, !r.enabled)}
                  >{r.enabled ? 'Disable' : 'Enable'}</Button
                >
                <Button size="sm" variant="danger" onclick={() => deleteRule(r.id)}>Delete</Button>
              </div>
              <div class="muted small">{(r.assignees as string[]).map(memberName).join(', ')}</div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </PageBody>
</PageShell>

<style>
  .queue,
  .rules {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    margin-top: var(--space-4, 16px);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3, 12px);
    padding: var(--space-3, 12px) var(--space-4, 16px);
    border: 1px solid var(--color-border-default, var(--hairline));
    border-radius: var(--radius-lg);
    background: var(--color-surface-2, var(--color-bg2));
  }
  .row.factory-row {
    border-left: 3px solid color-mix(in srgb, var(--color-accent) 72%, var(--color-warning));
    background:
      linear-gradient(
        90deg,
        color-mix(in srgb, var(--color-accent) 7%, transparent),
        transparent 35%
      ),
      var(--color-surface-2, var(--color-bg2));
  }
  .row :global(.badge) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1, 4px);
  }
  .work-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: var(--space-0-5, 2px);
  }
  .factory-meta {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-text-tertiary, var(--color-muted-foreground));
  }
  .open-gate {
    font-size: var(--font-size-body, 14px);
    font-weight: 650;
    color: var(--color-accent);
    text-decoration: none;
  }
  .open-gate:hover {
    text-decoration: underline;
  }
  .factory-offline {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    margin-top: var(--space-3, 12px);
    font-size: var(--font-size-caption, 12px);
    color: var(--color-text-tertiary, var(--color-muted-foreground));
  }
  .title {
    font-weight: 500;
    color: inherit;
    text-decoration: none;
  }
  .title:hover {
    text-decoration: underline;
  }
  .status {
    font-size: var(--font-size-body, 14px);
    opacity: 0.7;
    text-transform: capitalize;
  }
  .spacer {
    flex: 1;
  }
  .card {
    padding: var(--space-4, 16px) var(--space-4, 16px);
    border: 1px solid var(--color-border-default, var(--hairline));
    border-radius: var(--radius-lg);
    background: var(--color-surface-2, var(--color-bg2));
  }
  .new-rule h3 {
    margin: 0 0 var(--space-3, 12px);
    font-size: var(--font-size-page-title, 18px);
  }
  .inp {
    width: 100%;
    padding: var(--space-2, 8px) var(--space-3, 12px);
    margin-bottom: var(--space-3, 12px);
    border: 1px solid var(--color-border-default, var(--hairline));
    border-radius: var(--radius-md);
    background: var(--color-surface-2, var(--color-bg2));
    color: inherit;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3, 12px);
    margin-bottom: var(--space-3, 12px);
  }
  .grid label {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
    font-size: var(--font-size-body, 14px);
    opacity: 0.85;
  }
  .assignees {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2, 8px);
    align-items: center;
    margin-bottom: var(--space-3, 12px);
  }
  .assignees .lbl {
    font-size: var(--font-size-body, 14px);
    opacity: 0.7;
    margin-right: var(--space-1, 4px);
  }
  .rule-head {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
  }
  .muted {
    opacity: 0.7;
    font-size: var(--font-size-body, 14px);
  }
  .small {
    font-size: var(--font-size-body, 14px);
    margin-top: var(--space-1, 4px);
  }
</style>
