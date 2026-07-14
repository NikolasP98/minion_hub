<script lang="ts">
  import type { PageData } from './$types';
  import { invalidate } from '$app/navigation';
  import { PageHeader, Button, Select } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import { ArrowLeft } from 'lucide-svelte';
  import { relativeTime } from '$lib/components/crm/crm-format';
  import DocTimeline from '$lib/components/shared/DocTimeline.svelte';
  import { createBackNav } from '$lib/nav/back-nav.svelte';
  import { toastWarning } from '$lib/state/ui/toast.svelte';
  import * as m from '$lib/paraglide/messages';
  import { canAct } from '$lib/access/can.svelte';
  import { formatMoney } from '$lib/utils/format';

  let { data }: { data: PageData } = $props();
  const o = $derived(data.order);
  const back = createBackNav('/sales', () => 'Sales');
  let busy = $state(false);

  const STATUSES = ['draft', 'confirmed', 'invoiced', 'cancelled'];
  const statusLabel: Record<string, string> = {
    draft: 'Draft',
    confirmed: 'Confirmed',
    invoiced: 'Invoiced',
    cancelled: 'Cancelled',
  };

  async function postComment(body: string) {
    const res = await fetch('/api/activity/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refType: 'sales_order', refId: o.id, body }),
    });
    if (res.ok) await invalidate('sales:order');
  }

  async function setStatus(status: string) {
    busy = true;
    try {
      const res = await fetch(`/api/sales/orders/${o.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, expectedUpdatedAt: o.updatedAt }),
      });
      if (res.status === 409) toastWarning(m.shared_staleWrite());
      if (res.ok || res.status === 409) await invalidate('sales:order');
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
        body: JSON.stringify({ docType: 'sales_order', docId: o.id, action }),
      });
      if (res.ok) await invalidate('sales:order');
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{o.humanId ?? 'Order'} — Sales</title></svelte:head>

<PageShell archetype="record-detail" scroll="region" labelledBy="sales-id-title">
  <PageHeader
    titleId="sales-id-title"
    title={o.description ?? 'Sales order'}
    subtitle={`${o.humanId ?? 'Order'} · created ${relativeTime(o.createdAt)}`}
  >
    {#snippet leading()}
      <Button variant="ghost" size="sm" class="-ml-1" onclick={back.go} aria-label="Back to sales">
        <ArrowLeft size={16} />
      </Button>
    {/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region" class="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
    <!-- Left: detail + activity -->
    <div class="flex flex-col gap-4 min-h-0">
      <section class="card">
        <header class="card-h"><span>Order</span></header>
        <dl class="kv">
          <div>
            <dt>Customer</dt>
            <dd>{o.customerName ?? '—'}</dd>
          </div>
          <div>
            <dt>Total</dt>
            <dd>{o.total ? formatMoney(o.total, o.currency ?? undefined) : '—'}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{statusLabel[o.status] ?? o.status}</dd>
          </div>
        </dl>
      </section>
      <section class="card">
        <header class="card-h"><span>Activity</span></header>
        <DocTimeline items={data.timeline} onComment={postComment} />
      </section>
    </div>

    <!-- Right: controls -->
    <div class="flex flex-col gap-4">
      <section class="card">
        <header class="card-h"><span>Manage</span></header>
        {#if data.transitions.length}
          <div class="field">
            <span class="t-caption">Workflow</span>
            <div class="wf-actions">
              {#each data.transitions as t (t.action)}
                <Button
                  size="sm"
                  disabled={busy || !canAct('sales', 'edit')}
                  title={canAct('sales', 'edit') ? undefined : m.no_permission()}
                  onclick={() => applyTransition(t.action)}>{t.action}</Button
                >
              {/each}
            </div>
          </div>
        {/if}
        <Select
          class="field"
          label="Status"
          value={o.status}
          options={STATUSES.map((status) => ({ value: status, label: statusLabel[status] }))}
          disabled={busy || !canAct('sales', 'edit')}
          title={canAct('sales', 'edit') ? undefined : m.no_permission()}
          onchange={(value) => setStatus(String(value))}
        />
        {#if o.crmContactId}
          <a class="t-caption link" href={`/crm/${o.crmContactId}`}>View customer →</a>
        {/if}
      </section>
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
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: var(--space-2, 8px);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .kv {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
  }
  .kv div {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4, 16px);
    font-size: var(--font-size-body, 14px);
  }
  .kv dt {
    color: var(--color-muted-foreground);
  }
  .kv dd {
    font-variant-numeric: tabular-nums;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
    margin-bottom: var(--space-3, 12px);
  }
  .wf-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2, 8px);
  }
  .link {
    color: var(--color-accent);
  }
  .link:hover {
    text-decoration: underline;
  }
</style>
