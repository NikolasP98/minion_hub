<script lang="ts">
  import type { PageData } from './$types';
  import { goto, invalidate } from '$lib/navigation';
  import { page } from '$app/state';
  import { Wallet } from 'lucide-svelte';
  import * as m from '$lib/paraglide/messages';
  import { PageHeader, Badge, Button, SegmentedControl, iconSizes } from '$lib/components/ui';
  import { PageShell } from '$lib/components/ui/foundations';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import ClientAccountDrawer from '$lib/components/pos/ClientAccountDrawer.svelte';
  import { formatMoney } from '$lib/utils/format';
  import { canViewPath } from '$lib/access/can.svelte';

  let { data }: { data: PageData } = $props();
  type Row = PageData['accounts'][number];
  type PendingRow = PageData['unassignedPending'][number];
  const accountView = $derived(
    page.url.searchParams.get('pending') === 'unassigned' ? 'unassigned' : 'clients',
  );
  function showAccounts(value: string, pendingPage = data.pendingPage) {
    const url = new URL(page.url);
    if (value === 'unassigned') url.searchParams.set('pending', 'unassigned');
    else url.searchParams.delete('pending');
    if (pendingPage > 1) url.searchParams.set('pendingPage', String(pendingPage));
    else url.searchParams.delete('pendingPage');
    void goto(`${url.pathname}${url.search}`, { noScroll: true });
  }
  const pendingColumns = $derived<DataColumn<PendingRow>[]>([
    {
      key: 'sale',
      label: m.attachments_object_pos_ticket(),
      accessor: (line) => line.ticketHumanId ?? line.ticketId,
    },
    { key: 'service', label: m.pos_catalog_kind_service(), accessor: (line) => line.description },
    {
      key: 'customer',
      label: m.sched_booking_attendee(),
      accessor: (line) => line.customerName ?? m.pos_acct_unnamed(),
    },
    { key: 'schedule', label: m.pos_acct_col_pending_sched(), custom: true },
  ]);

  // Deep link from the till's customer summary (`?client=party:<id>`). A client
  // with no account movements is not in the list at all, so the load resolves
  // the key off the party spine / CRM contact and hands it back as
  // `requestedClient` — an empty account is still that client's account. Only a
  // key naming nothing in this org leaves `openRow` null, and then no drawer
  // opens.
  let openKey = $state<string | null>(page.url.searchParams.get('client'));
  const openRow = $derived(
    data.accounts.find((a) => a.clientKey === openKey) ??
      (data.requestedClient?.clientKey === openKey ? data.requestedClient : null),
  );

  const nameOf = (a: Row) => a.displayName ?? m.pos_acct_unnamed();

  // Labels are paraglide calls — build the list in a $derived so the table
  // re-labels on a locale switch.
  const columns = $derived<DataColumn<Row>[]>([
    { key: 'client', label: m.pos_acct_col_client(), accessor: nameOf },
    {
      key: 'balance',
      money: true,
      label: m.pos_acct_col_balance(),
      align: 'right',
      custom: true,
      accessor: (a) => a.balance,
    },
    {
      key: 'activeGrants',
      label: m.pos_acct_col_grants(),
      align: 'right',
      custom: true,
      accessor: (a) => a.activeGrants,
    },
    {
      key: 'openPlans',
      label: m.pos_acct_col_plans(),
      align: 'right',
      custom: true,
      accessor: (a) => a.openPlans,
    },
    {
      key: 'openPlanTotal',
      money: true,
      label: m.pos_acct_col_plan_total(),
      align: 'right',
      custom: true,
      accessor: (a) => a.openPlanTotal,
    },
    {
      key: 'pendingScheduling',
      label: m.pos_acct_col_pending_sched(),
      align: 'right',
      custom: true,
      accessor: (a) => a.pendingScheduling,
    },
  ]);
</script>

<svelte:head><title>{m.pos_acct_title()} — {m.nav_pos()}</title></svelte:head>

<PageShell archetype="collection" scroll="region" labelledBy="pos-accounts-title">
  <PageHeader
    titleId="pos-accounts-title"
    title={m.pos_acct_title()}
    subtitle={m.pos_acct_subtitle()}
  >
    {#snippet leading()}<Wallet size={iconSizes.md} class="text-accent shrink-0" />{/snippet}
  </PageHeader>

  <div class="account-views">
    <SegmentedControl
      aria-label={m.pos_acct_title()}
      value={accountView}
      items={[
        { value: 'clients', label: m.pos_acct_title() },
        {
          value: 'unassigned',
          label: m.pos_acct_unassigned(),
        },
      ]}
      onValueChange={(value) => showAccounts(value)}
    />
    {#if accountView === 'unassigned'}
      <p class="t-caption">{m.pos_acct_unassigned_hint()}</p>
      {#if data.pendingPage > 1 || data.hasMoreUnassigned}
        <div class="pending-pages">
          <Button
            variant="outline"
            size="sm"
            disabled={data.pendingPage <= 1}
            onclick={() => showAccounts('unassigned', data.pendingPage - 1)}
            >{m.pos_acct_pending_previous()}</Button
          >
          <Button
            variant="outline"
            size="sm"
            disabled={!data.hasMoreUnassigned}
            onclick={() => showAccounts('unassigned', data.pendingPage + 1)}
            >{m.pos_acct_pending_next()}</Button
          >
        </div>
      {/if}
    {/if}
  </div>

  {#if accountView === 'unassigned'}
    <DataTable
      class="flex-1 min-h-0"
      columns={pendingColumns}
      data={data.unassignedPending}
      getRowId={(line) => line.lineId}
      canEdit={false}
      emptyMessage={m.pos_acct_unassigned_empty()}
    >
      {#snippet cell(line: PendingRow, col: DataColumn<PendingRow>)}
        {#if col.key === 'schedule'}
          {#if canViewPath('/pos/sell')}
            <a class="pending-link" href={`/pos/sell?step=schedule&ticket=${line.ticketId}`}
              >{m.pos_acct_pending_sched_resume()}</a
            >
          {:else}
            <Badge variant="semantic" value="warning">{m.pos_acct_col_pending_sched()}</Badge>
          {/if}
        {/if}
      {/snippet}
    </DataTable>
  {:else}
    <DataTable
      class="flex-1 min-h-0"
      {columns}
      data={data.accounts}
      getRowId={(a) => a.clientKey}
      searchPlaceholder={m.data_table_search()}
      searchFields={(a) => nameOf(a)}
      storageKey="pos-accounts"
      canEdit={false}
      onRowClick={(a) => (openKey = a.clientKey)}
      emptyMessage={m.pos_acct_empty()}
    >
      {#snippet cell(a: Row, col: DataColumn<Row>)}
        {#if col.key === 'balance'}
          <span class="tabular-nums">{formatMoney(a.balance)}</span>
        {:else if col.key === 'openPlanTotal'}
          <span class="tabular-nums">{a.openPlans ? formatMoney(a.openPlanTotal) : '—'}</span>
        {:else if col.key === 'activeGrants'}
          {#if a.activeGrants}
            <Badge variant="semantic" value="success" size="sm">{a.activeGrants}</Badge>
          {:else}
            <span class="dim">—</span>
          {/if}
        {:else if col.key === 'openPlans'}
          {#if a.openPlans}
            <Badge variant="semantic" value="info" size="sm">{a.openPlans}</Badge>
          {:else}
            <span class="dim">—</span>
          {/if}
        {:else if col.key === 'pendingScheduling'}
          <!-- Services this client paid for and has not booked. The link RESUMES
             the sell flow's scheduling step on that ticket — same URL the sale
             itself lands on. `stopPropagation` so it doesn't also open the
             account drawer behind it. -->
          {#if a.pendingScheduling && a.pendingTicketId && canViewPath('/pos/sell')}
            <a
              class="pending-link"
              href={`/pos/sell?step=schedule&ticket=${a.pendingTicketId}`}
              title={m.pos_acct_pending_sched_resume()}
              onclick={(e) => e.stopPropagation()}
            >
              <Badge variant="semantic" value="warning" size="sm">{a.pendingScheduling}</Badge>
            </a>
          {:else if a.pendingScheduling}
            <Badge variant="semantic" value="warning" size="sm">{a.pendingScheduling}</Badge>
          {:else}
            <span class="dim">—</span>
          {/if}
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</PageShell>

<!-- `openRow`, not `openKey`: an unresolvable key opens nothing. -->
<ClientAccountDrawer
  clientKey={openRow ? openKey : null}
  clientName={openRow ? nameOf(openRow) : null}
  productNames={data.productNames}
  eventTypes={data.eventTypes}
  resources={data.resources}
  stockEnabled={data.stockEnabled}
  pendingScheduling={openRow?.pendingScheduling ?? 0}
  pendingTicketId={openRow?.pendingTicketId ?? null}
  onclose={() => (openKey = null)}
  onchanged={() => invalidate('pos:accounts')}
/>

<style>
  .account-views {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-card-compact);
    min-width: 0;
  }
  .pending-pages {
    display: flex;
    gap: var(--space-2);
  }
  .dim {
    color: var(--color-text-tertiary);
  }
  .pending-link {
    display: inline-flex;
    text-decoration: none;
  }
</style>
