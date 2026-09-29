<script lang="ts">
  /**
   * Read-only purchase record — what a receipt's "Document" cell and the
   * purchases list's title link open (spec 2026-09-28 Bundle D). Layout
   * mirrors `/pos/tickets/[id]` (record-detail shell, `.card` / `.kv` classes,
   * copied per route until promoted — see ui-design-governance skill).
   *
   * TODO(handoff): no attachments card — `fin_purchase` is not in
   * `AttachmentObjectType` (`src/server/db/pg-attachments-schema.ts`), so a
   * purchase's supporting documents (SUNAT XML, scanned invoice) have nowhere
   * to attach yet. See proposals/2026-09-28-hub-table-open-modes-followups.md.
   */
  import type { PageData } from './$types';
  import { Receipt, ArrowLeft } from 'lucide-svelte';
  import { PageHeader, Button, Badge, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import { createBackNav } from '$lib/nav/back-nav.svelte';
  import { inPeek } from '$lib/records/peek.svelte';
  import PeekLink from '$lib/records/PeekLink.svelte';
  import { formatMoney } from '$lib/utils/format';
  import * as m from '$lib/paraglide/messages';
  import { entryStatusVariant } from '$lib/components/stock/stock-ui';
  import EntryTypeBadge from '$lib/components/stock/EntryTypeBadge.svelte';

  let { data }: { data: PageData } = $props();
  const p = $derived(data.purchase);
  const entries = $derived(data.entries);
  const back = createBackNav('/finances/purchases', m.fin_purchase_back);

  const docLabel = $derived(
    p.serie && p.numero ? `${p.serie}-${p.numero}` : (p.providerRef ?? p.id.slice(0, 8)),
  );
  const cur = $derived(p.currency ?? 'PEN');
  const money = (v: string | number | null) => (v == null ? '—' : formatMoney(v, cur));
  const fmtDate = (v: string | Date | null) =>
    v
      ? new Date(v).toLocaleDateString(undefined, {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : '—';
  const typeLabel = (t: string) =>
    t === 'receipt'
      ? m.stock_type_receipt()
      : t === 'issue'
        ? m.stock_type_issue()
        : t === 'transfer'
          ? m.stock_type_transfer()
          : m.stock_type_adjustment();
  const statusLabel = (s: string) =>
    s === 'draft'
      ? m.stock_status_draft()
      : s === 'submitted'
        ? m.stock_status_submitted()
        : m.stock_status_cancelled();
</script>

<svelte:head><title>{docLabel} — {m.fin_purchases_title()}</title></svelte:head>

<PageShell archetype="record-detail" scroll="region" labelledBy="fin-purchase-title">
  <PageHeader titleId="fin-purchase-title" title={docLabel} subtitle={p.supplierName ?? '—'}>
    {#snippet leading()}
      {#if !inPeek()}
        <Button variant="ghost" size="sm" class="-ml-1" onclick={back.go} aria-label={back.label}>
          <ArrowLeft size={iconSizes.md} />
        </Button>
      {:else}
        <Receipt size={iconSizes.md} class="text-accent shrink-0" />
      {/if}
    {/snippet}
    {#snippet actions()}
      <Badge
        variant={p.source === 'sunat' ? 'semantic' : 'neutral'}
        value={p.source === 'sunat' ? 'info' : undefined}
      >
        {p.source === 'sunat' ? 'SUNAT' : m.fin_purchases_source_manual()}
      </Badge>
    {/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region" class="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
    <div class="flex flex-col gap-4 min-h-0">
      <section class="card">
        <header class="card-h"><span>{m.fin_purchase_section_facts()}</span></header>
        <dl class="kv">
          <div>
            <dt>{m.fin_purchases_col_supplier()}</dt>
            <dd>{p.supplierName ?? '—'}</dd>
          </div>
          <div>
            <dt>RUC</dt>
            <dd>{p.supplierRuc ?? '—'}</dd>
          </div>
          <div>
            <dt>{m.fin_purchases_col_doc()}</dt>
            <dd>{p.docType ?? '—'}</dd>
          </div>
          <div>
            <dt>{m.fin_purchases_col_date()}</dt>
            <dd>{fmtDate(p.issuedAt)}</dd>
          </div>
          <div>
            <dt>{m.fin_purchase_period()}</dt>
            <dd>{p.period}</dd>
          </div>
          <div>
            <dt>{m.fin_purchases_col_base()}</dt>
            <dd>{money(p.baseGravada)}</dd>
          </div>
          <div>
            <dt>{m.fin_purchases_col_igv()}</dt>
            <dd>{money(p.igv)}</dd>
          </div>
          <div>
            <dt>{m.fin_purchases_col_total()}</dt>
            <dd class="grand">{money(p.total)}</dd>
          </div>
        </dl>
      </section>
    </div>

    <div class="flex flex-col gap-4">
      <section class="card">
        <header class="card-h"><span>{m.fin_purchase_section_entries()}</span></header>
        {#if entries.length === 0}
          <p class="t-caption">{m.fin_purchase_no_entries()}</p>
        {:else}
          <ul class="plain">
            {#each entries as e (e.id)}
              {@const sv = entryStatusVariant(e.status)}
              <li>
                <PeekLink href={`/stock/entries/${e.id}`} class="link">
                  <EntryTypeBadge type={e.type} label={typeLabel(e.type)} />
                  <span>{e.humanId ?? e.id.slice(0, 8)}</span>
                </PeekLink>
                <Badge variant={sv.variant} value={sv.value} size="sm">
                  {statusLabel(e.status)}
                </Badge>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    </div>
  </PageBody>
</PageShell>

<style>
  .card {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface-1);
    padding: var(--space-3) var(--space-4);
  }
  .card-h {
    font-size: var(--font-size-caption);
    font-weight: 600;
    color: var(--color-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: var(--space-2);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .kv {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .kv div {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    font-size: var(--font-size-body);
  }
  .kv dt {
    color: var(--color-text-secondary);
  }
  .kv dd {
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .grand {
    font-weight: 600;
  }
  .plain {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .plain li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    font-size: var(--font-size-body);
  }
  .plain :global(.link) {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    color: inherit;
    text-decoration: none;
    min-width: 0;
  }
  .plain :global(.link:hover) {
    color: var(--color-accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
</style>
