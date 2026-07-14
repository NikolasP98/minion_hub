<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { PageHeader, Select } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import { ClipboardList, CircleDollarSign } from 'lucide-svelte';
  import { relativeTime } from '$lib/components/crm/crm-format';
  import ScopeBanner from '$lib/components/crm/ScopeBanner.svelte';
  import { toastWarning } from '$lib/state/ui/toast.svelte';
  import * as m from '$lib/paraglide/messages';
  import { canAct } from '$lib/access/can.svelte';
  import { formatMoney } from '$lib/utils/format';

  let { data }: { data: PageData } = $props();
  let busy = $state(false);

  const STATUSES = ['draft', 'confirmed', 'invoiced', 'cancelled'];
  const statusLabel: Record<string, string> = {
    draft: 'Draft',
    confirmed: 'Confirmed',
    invoiced: 'Invoiced',
    cancelled: 'Cancelled',
  };

  async function setStatus(id: string, status: string, expectedUpdatedAt: string | Date) {
    busy = true;
    try {
      const res = await fetch(`/api/sales/orders/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, expectedUpdatedAt }),
      });
      if (res.status === 409) toastWarning(m.shared_staleWrite());
      if (res.ok || res.status === 409) await invalidate('sales:list');
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Sales Orders</title></svelte:head>

<PageShell archetype="collection" scroll="region" labelledBy="sales-title">
  <PageHeader
    titleId="sales-title"
    title="Sales Orders"
    subtitle="Commitments to bill — created from bookings, reconciled against invoices"
  />

  <PageBody padding="compact" scroll="region" class="flex flex-col gap-4">
    {#if data.contactName}<div>
        <ScopeBanner name={data.contactName} contactId={data.contactId} noun="orders" />
      </div>{/if}
    <div class="kpis">
      <div class="kpi">
        <ClipboardList size={16} /><span class="n">{data.stats.open}</span><span class="l"
          >Open orders</span
        >
      </div>
      <div class="kpi">
        <CircleDollarSign size={16} /><span class="n">{formatMoney(data.stats.committed)}</span
        ><span class="l">Committed value</span>
      </div>
    </div>

    <section class="card list">
      {#each data.orders as o (o.id)}
        <div class="row">
          <a class="desc" href={`/sales/${o.id}`}
            >{#if o.humanId}<span class="hid">{o.humanId}</span>
            {/if}{o.description ?? '—'}</a
          >
          <span class="cust t-caption">{o.customerName ?? '—'}</span>
          <span class="total">{o.total ? formatMoney(o.total, o.currency ?? undefined) : '—'}</span>
          <Select
            size="sm"
            class="status-sel"
            value={o.status}
            disabled={busy || !canAct('sales', 'edit')}
            title={canAct('sales', 'edit') ? undefined : m.no_permission()}
            onchange={(value) => setStatus(o.id, String(value), o.updatedAt)}
          >
            {#each STATUSES as s (s)}<option value={s}>{statusLabel[s]}</option>{/each}
          </Select>
          <span class="when t-caption">{relativeTime(o.createdAt)}</span>
        </div>
      {:else}
        <p class="t-caption empty">No sales orders yet. Create one from a booking.</p>
      {/each}
    </section>
  </PageBody>
</PageShell>

<style>
  .kpis {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3, 12px);
    max-width: 32rem;
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
  .card {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
  }
  .list {
    display: flex;
    flex-direction: column;
    padding: var(--space-1, 4px) 0;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 8rem 6rem 8rem 6rem;
    align-items: center;
    gap: var(--space-3, 12px);
    padding: var(--space-2, 8px) var(--space-4, 16px);
    font-size: var(--font-size-body, 14px);
  }
  .row + .row {
    border-top: 1px solid var(--hairline);
  }
  .desc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hid {
    font-variant-numeric: tabular-nums;
    color: var(--color-muted-foreground);
    font-size: var(--font-size-body, 14px);
  }
  .total {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  :global(.status-sel) {
    height: 1.8rem;
    font-size: var(--font-size-body, 14px);
    border-radius: var(--radius-md);
    background: var(--color-bg3);
    border: 1px solid var(--hairline);
    padding: 0 var(--space-2, 8px);
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
    .list {
      gap: var(--space-2, var(--space-2, 8px));
      padding: 0;
      background: transparent;
      border: 0;
    }
    .row {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'desc total'
        'cust status'
        'when when';
      gap: var(--space-1, var(--space-1, 4px)) var(--space-2, var(--space-2, 8px));
      padding: var(--space-3, var(--space-3, 12px));
      border: 1px solid var(--color-border-default, var(--hairline));
      border-radius: var(--radius-lg);
      background: var(--color-surface-2, var(--color-card));
    }
    .row + .row {
      border-top: 1px solid var(--color-border-default, var(--hairline));
    }
    .desc {
      grid-area: desc;
    }
    .cust {
      grid-area: cust;
    }
    .total {
      grid-area: total;
    }
    :global(.status-sel) {
      grid-area: status;
      min-height: var(--control-height-touch, 44px);
    }
    .when {
      grid-area: when;
      justify-self: start;
    }
  }
</style>
