<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { ArrowLeftRight, ArrowLeft } from 'lucide-svelte';
  import { PageHeader, Button, Badge, Modal } from '$lib/components/ui';
  import { canAct } from '$lib/access/can.svelte';
  import { entryStatusVariant } from '$lib/components/stock/stock-ui';

  let { data }: { data: PageData } = $props();
  const entry = $derived(data.entry);
  const statusV = $derived(entryStatusVariant(entry.status));
  const statusLabel = $derived(
    entry.status === 'draft' ? m.stock_status_draft() : entry.status === 'submitted' ? m.stock_status_submitted() : m.stock_status_cancelled(),
  );
  const typeLabel = $derived(
    entry.type === 'receipt' ? m.stock_type_receipt() : entry.type === 'issue' ? m.stock_type_issue() : entry.type === 'transfer' ? m.stock_type_transfer() : m.stock_type_adjustment(),
  );

  let busy = $state(false);
  let err = $state<string | null>(null);
  let confirmCancelOpen = $state(false);

  async function errMessage(res: Response): Promise<string> {
    try {
      const body = await res.json();
      return body?.message ?? m.stock_submit_failed();
    } catch {
      return m.stock_submit_failed();
    }
  }

  async function submitEntry() {
    busy = true;
    err = null;
    try {
      const res = await fetch(`/api/stock/entries/${entry.id}/submit`, { method: 'POST' });
      if (res.ok) await invalidate('stock:entry-detail');
      else err = await errMessage(res);
    } finally {
      busy = false;
    }
  }

  async function cancelEntry() {
    busy = true;
    err = null;
    try {
      const res = await fetch(`/api/stock/entries/${entry.id}/cancel`, { method: 'POST' });
      confirmCancelOpen = false;
      if (res.ok) await invalidate('stock:entry-detail');
      else err = await errMessage(res);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{entry.humanId ?? entry.id} — {m.nav_stock()}</title></svelte:head>

<div class="flex flex-col h-full min-h-0 flex-1 min-w-0">
  <PageHeader title={entry.humanId ?? entry.id.slice(0, 8)} subtitle={typeLabel}>
    {#snippet leading()}<ArrowLeftRight size={16} class="text-accent shrink-0" />{/snippet}
    {#snippet actions()}
      <Button variant="outline" size="sm" onclick={() => history.back()}><ArrowLeft size={14} /> {m.common_back()}</Button>
      {#if entry.status === 'draft'}
        <Button
          variant="primary"
          size="sm"
          onclick={submitEntry}
          disabled={busy || !canAct('stock', 'edit')}
          title={canAct('stock', 'edit') ? undefined : m.no_permission()}
        >{m.stock_submit()}</Button>
      {:else if entry.status === 'submitted'}
        <Button
          variant="outline"
          size="sm"
          onclick={() => (confirmCancelOpen = true)}
          disabled={busy || !canAct('stock', 'manage')}
          title={canAct('stock', 'manage') ? undefined : m.no_permission()}
        >{m.stock_cancel_entry()}</Button>
      {/if}
    {/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4">
    {#if err}<p class="err-msg">{err}</p>{/if}
    <div class="card">
      <dl class="meta-grid">
        <dt>{m.stock_col_status()}</dt><dd><Badge variant={statusV.variant} value={statusV.value}>{statusLabel}</Badge></dd>
        <dt>{m.stock_col_party()}</dt><dd>{data.partyName ?? m.stock_no_party()}</dd>
        <dt>{m.stock_field_note()}</dt><dd>{entry.note ?? '—'}</dd>
        <dt>{m.stock_col_created()}</dt><dd>{new Date(entry.createdAt).toLocaleString()}</dd>
        {#if entry.postedAt}<dt>{m.stock_col_posted_at()}</dt><dd>{new Date(entry.postedAt).toLocaleString()}</dd>{/if}
      </dl>
    </div>

    <div class="card">
      <div class="card-h">{m.stock_entry_lines_title()}</div>
      <table class="mini-table">
        <thead>
          <tr>
            <th>{m.stock_field_item()}</th>
            <th class="num">{m.stock_field_qty()}</th>
            <th class="num">{m.stock_field_rate()}</th>
            <th>{m.stock_field_from_warehouse()}</th>
            <th>{m.stock_field_to_warehouse()}</th>
          </tr>
        </thead>
        <tbody>
          {#each data.lines as l (l.id)}
            <tr>
              <td>{l.itemLabel}</td>
              <td class="num">{Number(l.qty).toLocaleString()}</td>
              <td class="num">{l.rate != null ? Number(l.rate).toLocaleString() : '—'}</td>
              <td>{l.fromWarehouseName ?? '—'}</td>
              <td>{l.toWarehouseName ?? '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>

<Modal bind:open={confirmCancelOpen} title={m.stock_confirm_cancel_title()}>
  <p>{m.stock_confirm_cancel_body()}</p>
  {#snippet footer()}
    <Button variant="outline" size="sm" onclick={() => (confirmCancelOpen = false)}>{m.common_cancel()}</Button>
    <Button variant="primary" size="sm" onclick={cancelEntry} disabled={busy}>{m.common_confirm()}</Button>
  {/snippet}
</Modal>

<style>
  .card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); background: var(--color-card); padding: var(--space-3) var(--space-4); }
  .card-h { font-size: var(--font-size-body); font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: var(--color-muted-foreground); margin-bottom: var(--space-3); }
  .meta-grid { display: grid; grid-template-columns: max-content 1fr; gap: var(--space-2) var(--space-4); font-size: var(--font-size-body); align-items: center; }
  .meta-grid dt { color: var(--color-muted-foreground); }
  .mini-table { width: 100%; font-size: var(--font-size-body); border-collapse: collapse; }
  .mini-table th { text-align: left; font-weight: 500; color: var(--color-muted-foreground); padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--hairline); }
  .mini-table td { padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--hairline); }
  .mini-table .num { text-align: right; font-variant-numeric: tabular-nums; }
  .err-msg { font-size: var(--font-size-body); color: var(--color-destructive); }
</style>
