<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { PageHeader, Button, Select } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import { ArrowLeft, ExternalLink } from 'lucide-svelte';
  import {
    STATUSES,
    PRIORITIES,
    statusLabel,
    priorityLabel,
    priorityColor,
    slaColor,
  } from '$lib/components/support/support-format';
  import { relativeTime } from '$lib/components/crm/crm-format';
  import DocTimeline from '$lib/components/shared/DocTimeline.svelte';
  import { createBackNav } from '$lib/nav/back-nav.svelte';
  import { toastWarning } from '$lib/state/ui/toast.svelte';
  import * as m from '$lib/paraglide/messages';
  import { canAct } from '$lib/access/can.svelte';

  let { data }: { data: PageData } = $props();
  const i = $derived(data.issue);
  const back = createBackNav('/support', () => 'Support');
  let busy = $state(false);

  async function postComment(body: string) {
    const res = await fetch('/api/activity/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refType: 'support_issue', refId: i.id, body }),
    });
    if (res.ok) await invalidate('support:issue');
  }

  async function patch(body: Record<string, unknown>) {
    busy = true;
    try {
      const res = await fetch(`/api/support/issues/${i.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, expectedUpdatedAt: i.updatedAt }),
      });
      if (res.status === 409) toastWarning(m.shared_staleWrite());
      if (res.ok || res.status === 409) await invalidate('support:issue');
    } finally {
      busy = false;
    }
  }

  async function applyTransition(action: string) {
    busy = true;
    try {
      const res = await fetch('/api/workflow/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ docType: 'support_issue', docId: i.id, action }),
      });
      if (res.ok) await invalidate('support:issue');
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{i.subject} — Support</title></svelte:head>

<PageShell archetype="record-detail" scroll="region" labelledBy="support-id-title">
  <PageHeader
    titleId="support-id-title"
    title={i.subject}
    subtitle={`${i.humanId ?? 'Ticket'} · opened ${relativeTime(i.createdAt)}`}
  >
    {#snippet leading()}
      <Button
        variant="ghost"
        size="sm"
        class="-ml-1"
        onclick={back.go}
        aria-label="Back to tickets"
      >
        <ArrowLeft size={16} />
      </Button>
    {/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region" class="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
    <!-- Left: body + activity -->
    <div class="flex flex-col gap-4 min-h-0">
      <section class="card">
        <header class="card-h"><span>Description</span></header>
        <p class="desc">{i.description || 'No description.'}</p>
      </section>
      <section class="card">
        <header class="card-h"><span>Activity</span></header>
        <DocTimeline items={data.timeline} onComment={postComment} />
      </section>
    </div>

    <!-- Right: controls + SLA -->
    <div class="flex flex-col gap-4">
      <section class="card">
        <header class="card-h">
          <span>SLA</span>
          <span class="sla" style:--c={slaColor(data.sla.state)}>
            {data.sla.state === 'failed'
              ? 'Breached'
              : data.sla.state === 'fulfilled'
                ? 'Met'
                : 'On track'}
          </span>
        </header>
        <dl class="kv">
          <div>
            <dt>Response by</dt>
            <dd>{i.responseBy ? relativeTime(i.responseBy) : '—'}</dd>
          </div>
          <div>
            <dt>Resolution by</dt>
            <dd>{i.resolutionBy ? relativeTime(i.resolutionBy) : '—'}</dd>
          </div>
          <div>
            <dt>First reply</dt>
            <dd>{i.firstRespondedAt ? relativeTime(i.firstRespondedAt) : '—'}</dd>
          </div>
          <div>
            <dt>Resolved</dt>
            <dd>{i.resolvedAt ? relativeTime(i.resolvedAt) : '—'}</dd>
          </div>
        </dl>
      </section>

      <section class="card">
        <header class="card-h"><span>Manage</span></header>
        {#if data.transitions.length}
          <div class="field">
            <span class="t-caption">Workflow</span>
            <div class="wf-actions">
              {#each data.transitions as t (t.action)}
                <Button
                  size="sm"
                  disabled={busy || !canAct('support', 'edit')}
                  title={canAct('support', 'edit') ? undefined : m.no_permission()}
                  onclick={() => applyTransition(t.action)}>{t.action}</Button
                >
              {/each}
            </div>
          </div>
        {/if}
        <Select
          fieldClass="field"
          label="Status"
          value={i.status}
          options={STATUSES.map((status) => ({ value: status, label: statusLabel[status] }))}
          disabled={busy || !canAct('support', 'edit')}
          title={canAct('support', 'edit') ? undefined : m.no_permission()}
          onchange={(value) => patch({ status: String(value) })}
        />
        <Select
          fieldClass="field"
          label="Priority"
          value={i.priority}
          options={PRIORITIES.map((priority) => ({
            value: priority,
            label: priorityLabel[priority],
          }))}
          disabled={busy || !canAct('support', 'edit')}
          title={canAct('support', 'edit') ? undefined : m.no_permission()}
          onchange={(value) => patch({ priority: String(value) })}
        />
        <span class="pri" style:--c={priorityColor(i.priority)}>{priorityLabel[i.priority]}</span>
      </section>

      {#if i.crmContactId}
        <section class="card">
          <header class="card-h"><span>Customer</span></header>
          <a class="link-row" href={`/crm/${i.crmContactId}`}
            >View CRM contact <ExternalLink size={13} /></a
          >
        </section>
      {/if}
    </div>
  </PageBody>
</PageShell>

<style>
  .card {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    padding: var(--space-3, 12px) var(--space-4, 16px);
  }
  .card-h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2, 8px);
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: var(--space-2, 8px);
  }
  .desc {
    white-space: pre-wrap;
    font-size: var(--font-size-body, 14px);
    line-height: 1.5;
  }
  .kv {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2, 8px) var(--space-4, 16px);
  }
  .kv dt {
    font-size: var(--font-size-caption, 12px);
    color: var(--color-muted-foreground);
  }
  .kv dd {
    font-size: var(--font-size-body, 14px);
    font-weight: 600;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
    margin-bottom: var(--space-2, 8px);
  }
  .wf-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2, 8px);
  }
  .sla {
    color: var(--c);
    font-weight: 600;
    font-size: var(--font-size-caption, 12px);
    text-transform: none;
    letter-spacing: 0;
  }
  .pri {
    display: inline-block;
    padding: var(--space-0-5, 2px) var(--space-2, 8px);
    border-radius: var(--radius-full);
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    color: var(--c);
    background: color-mix(in srgb, var(--c) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--c) 30%, transparent);
  }
  .link-row {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2, 8px);
    color: var(--color-accent);
    font-size: var(--font-size-body, 14px);
  }
  .link-row:hover {
    text-decoration: underline;
  }
</style>
