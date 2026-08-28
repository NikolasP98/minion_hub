<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import { Receipt, RefreshCw, Plus, Pencil, Trash2, Lock } from 'lucide-svelte';
  import { PageHeader, Button, Badge, iconSizes } from '$lib/components/ui';
  import { PageShell, ConfirmDialog } from '$lib/components/ui/foundations';
  import { formatMoney } from '$lib/utils/format';
  import { canAct } from '$lib/access/can.svelte';
  import { fetchJson } from '$lib/api/fetch-json';
  import PurchaseFormDialog from '$lib/components/finance/PurchaseFormDialog.svelte';

  let { data }: { data: PageData } = $props();

  type Purchase = PageData['purchases'][number];

  const groups = $derived(
    data.periods.map((period) => ({
      period,
      rows: data.purchases.filter((p) => p.period === period.period),
    })),
  );

  function currentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const openPeriod = $derived(
    data.periods.find((p) => p.status === 'open')?.period ?? currentPeriod(),
  );

  function periodLabel(period: string): string {
    const y = period.slice(0, 4);
    const mo = Number(period.slice(4, 6));
    const d = new Date(Number(y), mo - 1, 1);
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  const canWrite = $derived(canAct('finance', 'edit'));

  let syncing = $state(false);
  let syncError = $state('');

  async function sync() {
    if (syncing) return;
    syncing = true;
    syncError = '';
    try {
      await fetchJson('/api/finances/purchases/sync', { method: 'POST' });
      await invalidate('finances:purchases');
    } catch (e) {
      syncError = e instanceof Error ? e.message : m.common_error();
    } finally {
      syncing = false;
    }
  }

  let showAdd = $state(false);
  let editing = $state<Purchase | null>(null);
  let deleting = $state<Purchase | null>(null);

  async function confirmDelete() {
    if (!deleting) return;
    await fetchJson(`/api/finances/purchases/${deleting.id}`, { method: 'DELETE' });
    await invalidate('finances:purchases');
  }
</script>

<svelte:head><title>{m.fin_purchases_title()}</title></svelte:head>

<PageShell archetype="collection" scroll="region" labelledBy="finances-purchases-title">
  <PageHeader
    titleId="finances-purchases-title"
    title={m.fin_purchases_title()}
    subtitle={m.fin_purchases_subtitle()}
  >
    {#snippet leading()}<Receipt size={iconSizes.md} class="text-accent shrink-0" />{/snippet}
    {#snippet secondaryActions()}
      <Button variant="outline" size="sm" loading={syncing} disabled={syncing} onclick={sync}>
        {#snippet icon()}<RefreshCw size={iconSizes.sm} />{/snippet}
        {m.fin_purchases_sync()}
      </Button>
    {/snippet}
    {#snippet primaryActions()}
      {#if canWrite}
        <Button variant="primary" size="sm" onclick={() => (showAdd = true)}>
          {#snippet icon()}<Plus size={iconSizes.sm} />{/snippet}
          {m.fin_purchases_add_title()}
        </Button>
      {/if}
    {/snippet}
  </PageHeader>

  {#if syncError}
    <p class="sync-error" role="alert">{syncError}</p>
  {/if}

  <div class="groups">
    {#if groups.length === 0}
      <p class="t-caption empty">{m.fin_purchases_empty()}</p>
    {/if}
    {#each groups as group (group.period.period)}
      <section class="period-group">
        <header class="period-header">
          <div class="period-title">
            <span class="t-title">{periodLabel(group.period.period)}</span>
            {#if group.period.status === 'closed'}
              <Badge variant="semantic" value="success">{m.fin_purchases_status_closed()}</Badge>
            {:else}
              <Badge variant="semantic" value="info">{m.fin_purchases_status_open()}</Badge>
            {/if}
          </div>
          <div class="period-totals t-caption">
            <span>{m.fin_purchases_doc_count({ n: group.period.docCount })}</span>
            <span class="tabular-nums">{formatMoney(group.period.total)}</span>
            {#if group.period.lastSyncedAt}
              <span
                >{m.fin_purchases_last_synced({
                  date: new Date(group.period.lastSyncedAt).toLocaleString(),
                })}</span
              >
            {/if}
          </div>
        </header>

        {#if group.rows.length === 0}
          <p class="t-caption row-empty">{m.fin_purchases_period_empty()}</p>
        {:else}
          <div class="table-wrap">
            <table class="purchase-table">
              <thead>
                <tr>
                  <th>{m.fin_purchases_col_supplier()}</th>
                  <th>{m.fin_purchases_col_doc()}</th>
                  <th>{m.fin_purchases_col_date()}</th>
                  <th class="num">{m.fin_purchases_col_base()}</th>
                  <th class="num">{m.fin_purchases_col_igv()}</th>
                  <th class="num">{m.fin_purchases_col_total()}</th>
                  <th>{m.fin_purchases_col_source()}</th>
                  {#if group.period.status === 'open' && canWrite}
                    <th class="actions-col"></th>
                  {/if}
                </tr>
              </thead>
              <tbody>
                {#each group.rows as row (row.id)}
                  <tr>
                    <td
                      >{row.supplierName ?? '—'}{#if row.supplierRuc}<span class="t-caption ruc">
                          · {row.supplierRuc}</span
                        >{/if}</td
                    >
                    <td class="mono"
                      >{[row.docType, row.serie, row.numero].filter(Boolean).join('-') || '—'}</td
                    >
                    <td>{row.issuedAt ?? '—'}</td>
                    <td class="num tabular-nums"
                      >{formatMoney(row.baseGravada, row.currency ?? 'PEN')}</td
                    >
                    <td class="num tabular-nums">{formatMoney(row.igv, row.currency ?? 'PEN')}</td>
                    <td class="num tabular-nums font-medium"
                      >{formatMoney(row.total, row.currency ?? 'PEN')}</td
                    >
                    <td>
                      <Badge
                        variant={row.source === 'sunat' ? 'semantic' : 'neutral'}
                        value={row.source === 'sunat' ? 'info' : undefined}
                      >
                        {row.source === 'sunat' ? 'SUNAT' : m.fin_purchases_source_manual()}
                      </Badge>
                      {#if row.syncState === 'diverged'}
                        <Badge variant="semantic" value="warning"
                          >{m.fin_purchases_diverged()}</Badge
                        >
                      {/if}
                    </td>
                    {#if group.period.status === 'open' && canWrite}
                      <td class="actions-col">
                        <Button
                          variant="ghost"
                          size="xs"
                          shape="icon"
                          aria-label={m.common_edit()}
                          onclick={() => (editing = row)}
                        >
                          {#snippet icon()}<Pencil size={iconSizes.sm} />{/snippet}
                        </Button>
                        <Button
                          variant="ghost"
                          size="xs"
                          shape="icon"
                          aria-label={m.common_delete()}
                          onclick={() => (deleting = row)}
                        >
                          {#snippet icon()}<Trash2 size={iconSizes.sm} />{/snippet}
                        </Button>
                      </td>
                    {:else if group.period.status === 'closed'}
                      <td class="actions-col"><Lock size={iconSizes.xs} class="locked-icon" /></td>
                    {/if}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
    {/each}
  </div>
</PageShell>

<PurchaseFormDialog bind:open={showAdd} period={openPeriod} />
{#if editing}
  <PurchaseFormDialog
    open={true}
    period={editing.period}
    purchase={editing}
    onclose={() => (editing = null)}
  />
{/if}
{#if deleting}
  <ConfirmDialog
    open={true}
    title={m.fin_purchases_delete_title()}
    message={m.fin_purchases_delete_message()}
    failureMessage={m.fin_purchases_delete_failed()}
    tone="danger"
    onconfirm={confirmDelete}
    onclose={() => (deleting = null)}
  />
{/if}

<style>
  .sync-error {
    color: var(--color-danger-fg);
    font-size: var(--font-size-caption);
    padding: 0 var(--space-4);
  }
  .groups {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-4) var(--space-6);
    overflow-y: auto;
  }
  .empty {
    color: var(--color-text-tertiary);
    padding: var(--space-4);
  }
  .period-group {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    overflow: hidden;
  }
  .period-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--color-surface-2);
    border-bottom: 1px solid var(--hairline);
    flex-wrap: wrap;
  }
  .period-title {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .period-totals {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    color: var(--color-text-secondary);
  }
  .row-empty {
    color: var(--color-text-tertiary);
    padding: var(--space-3) var(--space-4);
  }
  .table-wrap {
    overflow-x: auto;
  }
  .purchase-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--font-size-body);
  }
  .purchase-table th {
    text-align: left;
    padding: var(--space-2) var(--space-4);
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
    font-weight: 500;
    border-bottom: 1px solid var(--hairline);
    white-space: nowrap;
  }
  .purchase-table td {
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--hairline);
    color: var(--color-text-primary);
    vertical-align: middle;
  }
  .purchase-table tbody tr:last-child td {
    border-bottom: none;
  }
  .num {
    text-align: right;
  }
  .mono {
    font-family: var(--font-mono, monospace);
    font-size: var(--font-size-caption);
  }
  .ruc {
    color: var(--color-text-tertiary);
  }
  .actions-col {
    text-align: right;
    white-space: nowrap;
  }
  .actions-col :global(.locked-icon) {
    color: var(--color-text-tertiary);
  }
</style>
