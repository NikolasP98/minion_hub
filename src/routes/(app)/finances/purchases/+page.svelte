<script lang="ts">
  import type { PageData } from './$types';
  import { page } from '$app/state';
  import { invalidate } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import { Receipt, RefreshCw, Plus, Pencil, Trash2 } from 'lucide-svelte';
  import { PageHeader, Button, Badge, iconSizes } from '$lib/components/ui';
  import { PageShell, ConfirmDialog } from '$lib/components/ui/foundations';
  import { formatMoney } from '$lib/utils/format';
  import { canAct } from '$lib/access/can.svelte';
  import { fetchJson } from '$lib/api/fetch-json';
  import PurchaseFormDialog from '$lib/components/finance/PurchaseFormDialog.svelte';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import { orderByList, type GroupSpec } from '$lib/components/data-table/group-by';

  let { data }: { data: PageData } = $props();

  type Purchase = PageData['purchases'][number];
  type Period = PageData['periods'][number];

  // ONE table grouped by period (spec 2026-09-28 §T3) — it used to be one plain
  // table per period inside its own card, so a purchase could not be sorted,
  // searched or compared across periods, and every card re-rendered its own
  // header row. The period card header now renders in the `groupRow` snippet.
  const periodOf = $derived(new Map<string, Period>(data.periods.map((p) => [p.period, p])));
  const periodGroup = $derived<GroupSpec<Purchase>>({
    of: (r) => r.period,
    label: (key) => periodLabel(key),
    // The server already ranks periods (newest first); keep exactly that order.
    order: orderByList(data.periods.map((p) => p.period)),
  });
  // TODO(handoff): a period with NO purchases no longer appears at all — a
  // grouped table can only show buckets that have rows, where the old
  // one-card-per-period markup rendered an explicit "no documents in this
  // period" card. Decide whether an empty period deserves a row (a synthetic
  // zero-row group, or a separate list above the table) — see
  // proposals/2026-09-28-hub-table-standardization-followups.md.

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

  // TODO(handoff): the pre-migration markup rendered a lone Lock icon for closed
  // periods (with no matching <th> — an existing header/body column-count
  // mismatch); that indicator is still dropped rather than reproduced. Confirm
  // whether closed periods should show a read-only lock affordance in
  // `rowActions` — proposals/2026-09-28-hub-table-standardization-followups.md.
  /** Edit/delete are per ROW now, gated on that row's own period status. */
  const rowWritable = (r: Purchase) => canWrite && periodOf.get(r.period)?.status === 'open';
  const columns = $derived.by<DataColumn<Purchase>[]>(() => {
    const cols: DataColumn<Purchase>[] = [
      {
        key: 'supplier',
        label: m.fin_purchases_col_supplier(),
        fill: true,
        accessor: (r) => r.supplierName ?? '—',
      },
      {
        key: 'issuedAt',
        label: m.fin_purchases_col_date(),
        accessor: (r) => r.issuedAt ?? '—',
      },
      {
        key: 'baseGravada',
        label: m.fin_purchases_col_base(),
        align: 'right',
        numeric: true,
        cellClass: 'tabular-nums',
        accessor: (r) => Number(r.baseGravada),
      },
      {
        key: 'igv',
        label: m.fin_purchases_col_igv(),
        align: 'right',
        numeric: true,
        cellClass: 'tabular-nums',
        accessor: (r) => Number(r.igv),
      },
      {
        key: 'total',
        label: m.fin_purchases_col_total(),
        align: 'right',
        numeric: true,
        cellClass: 'tabular-nums font-medium',
        accessor: (r) => Number(r.total),
      },
      {
        key: 'source',
        label: m.fin_purchases_col_source(),
      },
    ];
    return cols;
  });

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
  // ?new=1 (assistant deep link) opens the add dialog — only into an open period.
  // Reactive (not onMount): the assistant may navigate to ?new=1 while the page is mounted.
  $effect(() => {
    if (
      page.url.searchParams.get('new') === '1' &&
      canWrite &&
      data.periods.find((p) => p.period === openPeriod)?.status !== 'closed'
    )
      showAdd = true;
  });
  let editing = $state<Purchase | null>(null);
  let deleting = $state<Purchase | null>(null);

  async function confirmDelete() {
    if (!deleting) return;
    await fetchJson(`/api/finances/purchases/${deleting.id}`, { method: 'DELETE' });
    await invalidate('finances:purchases');
  }
</script>

<svelte:head><title>{m.fin_purchases_title()}</title></svelte:head>

{#snippet supplierCell(row: Purchase)}
  {row.supplierName ?? '—'}{#if row.supplierRuc}<span class="t-caption ruc">
      · {row.supplierRuc}</span
    >{/if}
{/snippet}
{#snippet baseCell(row: Purchase)}
  {formatMoney(row.baseGravada, row.currency ?? 'PEN')}
{/snippet}
{#snippet igvCell(row: Purchase)}
  {formatMoney(row.igv, row.currency ?? 'PEN')}
{/snippet}
{#snippet totalCell(row: Purchase)}
  {formatMoney(row.total, row.currency ?? 'PEN')}
{/snippet}
{#snippet sourceCell(row: Purchase)}
  <Badge
    variant={row.source === 'sunat' ? 'semantic' : 'neutral'}
    value={row.source === 'sunat' ? 'info' : undefined}
  >
    {row.source === 'sunat' ? 'SUNAT' : m.fin_purchases_source_manual()}
  </Badge>
  {#if row.syncState === 'diverged'}
    <Badge variant="semantic" value="warning">{m.fin_purchases_diverged()}</Badge>
  {/if}
{/snippet}
{#snippet rowActions(row: Purchase)}
  {#if rowWritable(row)}
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
  {/if}
{/snippet}
{#snippet groupRow(key: string)}
  {@const period = periodOf.get(key)}
  <span class="period-title">
    <span class="t-title">{periodLabel(key)}</span>
    {#if period?.status === 'closed'}
      <Badge variant="semantic" value="success">{m.fin_purchases_status_closed()}</Badge>
    {:else}
      <Badge variant="semantic" value="info">{m.fin_purchases_status_open()}</Badge>
    {/if}
  </span>
  {#if period}
    <span class="period-totals t-caption">
      <span>{m.fin_purchases_doc_count({ n: period.docCount })}</span>
      <span class="tabular-nums">{formatMoney(period.total)}</span>
      {#if period.lastSyncedAt}
        <span
          >{m.fin_purchases_last_synced({
            date: new Date(period.lastSyncedAt).toLocaleString(),
          })}</span
        >
      {/if}
    </span>
  {/if}
{/snippet}

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
    {#if data.purchases.length === 0}
      <p class="t-caption empty">{m.fin_purchases_empty()}</p>
    {:else}
      <div class="period-group">
        <div class="table-wrap">
          <DataTable
            variant="plain"
            data={data.purchases}
            {columns}
            getRowId={(r) => r.id}
            customProperties={{
              bundle: data.customProperties,
              recordId: (purchase) => purchase.id,
              scopeKey: `${data.activeOrgId ?? ''}:finances.purchases`,
            }}
            tableId="finances.purchases"
            idColumn={{
              value: (r) => [r.docType, r.serie, r.numero].filter(Boolean).join('-') || '—',
            }}
            groupBy={periodGroup}
            {groupRow}
            {rowActions}
            rowActionsMode="always"
            cells={{
              supplier: supplierCell,
              baseGravada: baseCell,
              igv: igvCell,
              total: totalCell,
              source: sourceCell,
            }}
          />
        </div>
      </div>
    {/if}
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
  /* Both live inside the table's group header cell (an inline <td>), so they
     are inline-flex rows rather than the old flex card header. */
  .period-title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
  .period-totals {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    margin-left: var(--space-3);
    color: var(--color-text-secondary);
  }
  .table-wrap {
    overflow-x: auto;
  }
  :global(.mono) {
    font-family: var(--font-mono, monospace);
    font-size: var(--font-size-caption);
  }
  .ruc {
    color: var(--color-text-tertiary);
  }
</style>
