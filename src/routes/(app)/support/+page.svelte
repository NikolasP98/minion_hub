<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { PageHeader, Button, Select } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import { Plus, AlertTriangle, Inbox, CheckCircle2 } from 'lucide-svelte';
  import {
    priorityLabel,
    priorityColor,
    slaColor,
    PRIORITIES,
  } from '$lib/components/support/support-format';
  import { relativeTime } from '$lib/components/crm/crm-format';
  import ScopeBanner from '$lib/components/crm/ScopeBanner.svelte';
  import * as m from '$lib/paraglide/messages';
  import { canAct } from '$lib/access/can.svelte';

  let { data }: { data: PageData } = $props();

  // Opened pre-bound to a contact from the Connections "+New" action.
  // svelte-ignore state_referenced_locally
  let creating = $state(data.openCreate ?? false);
  let subject = $state('');
  let priority = $state('medium');
  let busy = $state(false);

  async function create() {
    if (!subject.trim()) return;
    busy = true;
    try {
      const res = await fetch('/api/support/issues', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), priority, crmContactId: data.contactId }),
      });
      if (res.ok) {
        subject = '';
        priority = 'medium';
        creating = false;
        await invalidate('support:list');
      }
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Support</title></svelte:head>

<PageShell archetype="collection" scroll="region" labelledBy="support-title">
  <PageHeader titleId="support-title" title="Support" subtitle="Customer tickets with SLA tracking">
    {#snippet primaryActions()}
      <Button
        variant="primary"
        size="sm"
        disabled={!canAct('support', 'edit')}
        title={canAct('support', 'edit') ? undefined : m.no_permission()}
        onclick={() => (creating = !creating)}
      >
        <Plus size={14} /> New ticket
      </Button>
    {/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region" class="flex flex-col gap-4">
    {#if data.contactName}<div>
        <ScopeBanner name={data.contactName} contactId={data.contactId} noun="tickets" />
      </div>{/if}
    <!-- KPI row -->
    <div class="kpis">
      <div class="kpi">
        <Inbox size={16} /><span class="n">{data.stats.open}</span><span class="l">Open</span>
      </div>
      <div class="kpi" class:warn={data.stats.breached > 0}>
        <AlertTriangle size={16} /><span class="n">{data.stats.breached}</span><span class="l"
          >SLA breached</span
        >
      </div>
      <div class="kpi">
        <CheckCircle2 size={16} /><span class="n">{data.stats.resolvedToday}</span><span class="l"
          >Resolved today</span
        >
      </div>
    </div>

    {#if creating}
      <section class="card create">
        <input
          class="inp"
          bind:value={subject}
          placeholder="Ticket subject…"
          onkeydown={(e) => e.key === 'Enter' && create()}
        />
        <Select class="inp sel" size="sm" bind:value={priority}>
          {#each PRIORITIES as p (p)}<option value={p}>{priorityLabel[p]}</option>{/each}
        </Select>
        <Button variant="primary" size="sm" onclick={create} disabled={busy || !subject.trim()}
          >Create</Button
        >
        <Button variant="ghost" size="sm" onclick={() => (creating = false)}>Cancel</Button>
      </section>
    {/if}

    <!-- Ticket list -->
    <section class="card list">
      {#each data.issues as it (it.id)}
        <a class="row" href={`/support/${it.id}`}>
          <span class="pri" style:--c={priorityColor(it.priority)}
            >{priorityLabel[it.priority]}</span
          >
          <span class="subj"
            >{#if it.humanId}<span class="hid">{it.humanId}</span>
            {/if}{it.subject}</span
          >
          <span class="status">{it.status}</span>
          <span
            class="sla"
            style:--c={slaColor(it.sla.state)}
            title={it.sla.dueBy ? `Due ${relativeTime(it.sla.dueBy)}` : ''}
          >
            {it.sla.state === 'failed'
              ? 'Breached'
              : it.sla.state === 'fulfilled'
                ? 'Met'
                : it.sla.dueBy
                  ? `Due ${relativeTime(it.sla.dueBy)}`
                  : '—'}
          </span>
          <span class="when t-caption">{relativeTime(it.createdAt)}</span>
        </a>
      {:else}
        <p class="t-caption empty">No open tickets.</p>
      {/each}
    </section>
  </PageBody>
</PageShell>

<style>
  .kpis {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3, 12px);
  }
  .kpi {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    padding: var(--space-3, 12px) var(--space-4, 16px);
    color: var(--color-muted-foreground);
  }
  .kpi .n {
    font-size: var(--font-size-display, 28px);
    font-weight: 700;
    color: var(--color-foreground);
    font-variant-numeric: tabular-nums;
    margin-left: auto;
  }
  .kpi .l {
    font-size: var(--font-size-caption, 12px);
  }
  .kpi.warn .n {
    color: var(--color-danger-fg, var(--color-destructive));
  }
  .card {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
  }
  .create {
    display: flex;
    gap: var(--space-2, 8px);
    align-items: center;
    padding: var(--space-3, 12px) var(--space-4, 16px);
  }
  .inp {
    height: 2rem;
    padding: 0 var(--space-3, 12px);
    font-size: var(--font-size-page-title, 18px);
    border-radius: var(--radius-md);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
  }
  .inp:first-child {
    flex: 1;
  }
  :global(.sel) {
    width: 8rem;
  }
  .list {
    display: flex;
    flex-direction: column;
    padding: var(--space-1, 4px) 0;
  }
  .row {
    display: grid;
    grid-template-columns: 5rem 1fr 6rem 7rem 6rem;
    align-items: center;
    gap: var(--space-3, 12px);
    padding: var(--space-2, 8px) var(--space-4, 16px);
    color: inherit;
    text-align: left;
    text-decoration: none;
    font-size: var(--font-size-body, 14px);
    width: 100%;
  }
  .row + .row {
    border-top: 1px solid var(--hairline);
  }
  .row:hover {
    background: color-mix(in srgb, var(--color-text-primary) 4%, transparent);
  }
  .pri {
    justify-self: start;
    padding: var(--space-0-5, 2px) var(--space-2, 8px);
    border-radius: var(--radius-full);
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    color: var(--c);
    background: color-mix(in srgb, var(--c) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--c) 30%, transparent);
  }
  .subj {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hid {
    font-variant-numeric: tabular-nums;
    color: var(--color-muted-foreground);
    font-size: var(--font-size-body, 14px);
  }
  .status {
    color: var(--color-muted-foreground);
    text-transform: capitalize;
  }
  .sla {
    color: var(--c);
    font-weight: 600;
    font-size: var(--font-size-body, 14px);
  }
  .when {
    justify-self: end;
  }
  .empty {
    padding: var(--space-section, 24px) var(--space-4, 16px);
  }
  @media (max-width: 767.98px) {
    .kpis {
      grid-template-columns: minmax(0, 1fr);
    }
    .create {
      align-items: stretch;
      flex-direction: column;
    }
    .inp,
    :global(.sel) {
      width: 100%;
      min-height: var(--control-height-touch, 44px);
    }
    .list {
      gap: var(--space-2, var(--space-2, 8px));
      padding: 0;
      background: transparent;
      border: 0;
    }
    .row {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'priority status'
        'subject subject'
        'sla when';
      gap: var(--space-1, var(--space-1, 4px)) var(--space-2, var(--space-2, 8px));
      min-height: var(--control-height-touch, 44px);
      padding: var(--space-3, var(--space-3, 12px));
      border: 1px solid var(--color-border-default, var(--hairline));
      border-radius: var(--radius-lg);
      background: var(--color-surface-2, var(--color-card));
    }
    .row + .row {
      border-top: 1px solid var(--color-border-default, var(--hairline));
    }
    .pri {
      grid-area: priority;
    }
    .subj {
      grid-area: subject;
    }
    .status {
      grid-area: status;
      justify-self: end;
    }
    .sla {
      grid-area: sla;
    }
    .when {
      grid-area: when;
    }
  }
</style>
