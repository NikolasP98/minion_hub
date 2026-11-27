<script lang="ts">
  import { ScrollText } from 'lucide-svelte';
  import { goto } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import { Button, Card, EmptyState } from '$lib/components/ui';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { formatDate } from '$lib/utils/format';
  import { lockReason } from '$lib/components/stock/lock-reasons';
  import type { LockEventAction, LockEventRow, LockPolicy } from '$lib/types/record-locks';

  let {
    events,
    pageSize = 100,
  }: {
    events: LockEventRow[];
    /** The page asked for this many rows; getting that many back means there may be more. */
    pageSize?: number;
  } = $props();

  const ACTION: Record<LockEventAction, () => string> = {
    lock: m.record_locks_action_lock,
    lift: m.record_locks_action_lift,
    unlock: m.record_locks_action_unlock,
    unlock_used: m.record_locks_action_unlock_used,
    refused: m.record_locks_action_refused,
    policy_changed: m.record_locks_action_policy_changed,
  };

  const when = (iso: string) =>
    formatDate(iso, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  const actor = (e: LockEventRow) =>
    e.actorKind === 'system'
      ? m.record_locks_actor_system()
      : e.actorKind === 'api_key'
        ? m.record_locks_actor_webhook({ name: e.actorName ?? '' })
        : (e.actorName ?? '—');

  /** "after 60 days · when the month closes" for a `policy_changed` row. */
  function policyText(p: LockPolicy): string {
    const parts = [
      p.month ? m.record_locks_policy_month() : null,
      p.days !== null ? m.record_locks_policy_days({ days: p.days }) : null,
      p.webhook ? m.record_locks_policy_webhook() : null,
    ].filter((x): x is string => !!x);
    return parts.length ? parts.join(' · ') : m.record_locks_policy_none();
  }

  function detailParts(e: LockEventRow): string[] {
    const parts: string[] = [];
    if (e.action === 'policy_changed') {
      const after = e.detail.after as LockPolicy | undefined;
      if (after) parts.push(policyText(after));
    } else {
      if (e.rules.length) parts.push(...e.rules.map(lockReason));
    }
    parts.push(actor(e));
    return parts;
  }

  const columns: DataColumn<LockEventRow>[] = [
    {
      key: 'occurredAt',
      label: m.record_locks_audit_col_when(),
      accessor: (r) => r.occurredAt,
      custom: true,
      width: 140,
    },
    {
      key: 'action',
      label: m.record_locks_audit_col_what(),
      accessor: (r) => ACTION[r.action](),
      custom: true,
      fill: true,
    },
    {
      key: 'reason',
      label: m.record_locks_audit_col_reason(),
      accessor: (r) => r.reason ?? '',
      custom: true,
      width: 260,
    },
  ];

  // shortcut: "Cargar más" re-reads the whole list through `?events=N` (cap 500); add a cursor route if the log outgrows that.
  const hasMore = $derived(events.length >= pageSize);
  let loading = $state(false);
  async function more() {
    loading = true;
    try {
      await goto(`?events=${pageSize + 100}`, { keepFocus: true, noScroll: true });
    } finally {
      loading = false;
    }
  }
</script>

{#snippet whenCell(r: LockEventRow)}<span class="muted">{when(r.occurredAt)}</span>{/snippet}
{#snippet actionCell(r: LockEventRow)}
  <div class="what">
    <span class="t-label">{ACTION[r.action]()}</span>
    <span class="t-caption muted">
      {#if r.recordId && r.recordLabel}<a class="card-link" href={`/stock/entries/${r.recordId}`}
          >{r.recordLabel}</a
        >{' · '}{/if}{detailParts(r).join(' · ')}
    </span>
  </div>
{/snippet}
{#snippet reasonCell(r: LockEventRow)}
  <span class="muted">{r.reason ?? (r.action === 'lock' ? String(r.detail.label ?? '') : '')}</span>
{/snippet}
{#snippet tableEmpty()}
  <EmptyState icon={ScrollText} title={m.record_locks_audit_empty()} compact />
{/snippet}

<section class="section" aria-labelledby="record-locks-audit-title">
  <h2 id="record-locks-audit-title" class="t-title">{m.record_locks_audit_title()}</h2>
  <Card padding="none">
    <DataTable
      ariaLabel={m.record_locks_audit_title()}
      variant="plain"
      data={events}
      {columns}
      getRowId={(r) => r.id}
      empty={tableEmpty}
      cells={{ occurredAt: whenCell, action: actionCell, reason: reasonCell }}
    />
  </Card>
  {#if hasMore}
    <div class="more">
      <Button variant="outline" size="sm" onclick={more} {loading}
        >{m.record_locks_audit_more()}</Button
      >
    </div>
  {/if}
</section>

<style>
  .card-link {
    color: var(--color-accent);
    text-decoration: none;
  }
  .card-link:hover,
  .card-link:focus-visible {
    text-decoration: underline;
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-section);
  }
  .what {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }
  .muted {
    color: var(--color-text-secondary);
  }
  .more {
    display: flex;
    justify-content: center;
  }
</style>
