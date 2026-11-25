<script lang="ts">
  import type { PageData as LoadedPageData } from './$types';
  import type { Granted } from '$lib/permissions';
  import { invalidate } from '$app/navigation';
  import * as m from '$lib/paraglide/messages';
  import { appLocale, formatMoney, formatNumber } from '$lib/utils/format';
  import { ArrowLeftRight, ArrowLeft } from 'lucide-svelte';
  import { inPeek } from '$lib/records/peek.svelte';
  import { iconSizes, PageHeader, Button, Badge, Modal, Input } from '$lib/components/ui';
  import { page } from '$app/state';
  import CorrectionFlow from '$lib/components/stock/CorrectionFlow.svelte';
  import LockNotice from '$lib/components/stock/LockNotice.svelte';
  import { lockReason } from '$lib/components/stock/lock-reasons';
  import { canAct } from '$lib/access/can.svelte';
  import { entryStatusVariant } from '$lib/components/stock/stock-ui';
  import { stockRefusal } from '$lib/components/stock/exchange';
  import { entryTypeLabel } from '$lib/components/stock/entry-type-label';
  import { AttachmentButton, AttachmentList } from '$lib/components/attachments';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';

  type PageData = Granted<LoadedPageData['stock']>;
  let { data }: { data: PageData } = $props();
  type LineRow = PageData['lines'][number];
  const entry = $derived(data.entry);
  const statusV = $derived(entryStatusVariant(entry.status));
  const statusLabel = $derived(
    entry.status === 'draft'
      ? m.stock_status_draft()
      : entry.status === 'submitted'
        ? m.stock_status_submitted()
        : m.stock_status_cancelled(),
  );
  const typeLabel = $derived(entryTypeLabel(entry.type) ?? entry.type);

  // ── Receipt correction (spec 124): cancel + replace with the corrected quantity or rate ──
  const meta = $derived((entry.metadata ?? {}) as Record<string, unknown>);
  const correctedFrom = $derived(typeof meta.correctionOf === 'string' ? meta.correctionOf : null);
  // The server decides eligibility (standalone, nothing later on its bins, open period); this only
  // hides the action where it can never apply.
  const canCorrect = $derived(
    entry.type === 'receipt' &&
      entry.status === 'submitted' &&
      !meta.source &&
      !meta.invoiceId &&
      !meta.sourceId &&
      !data.replacementEntryId &&
      canAct('stock', 'manage') &&
      data.lines.every((l) => l.rate != null && l.toWarehouseId),
  );
  // Spec 140: the organization's lock policy (null = not evaluated). A locked record cannot be corrected.
  const lock = $derived(data.lock ?? null);
  let correcting = $state(false);
  let edits = $state<Record<string, { qty: string; rate: string }>>({});
  const DECIMAL = /^\d{1,9}(\.\d{1,4})?$/;
  function openCorrection() {
    edits = Object.fromEntries(
      data.lines.map((l) => [l.id, { qty: String(l.qty), rate: String(l.rate ?? '') }]),
    );
    correcting = true;
  }
  const qtyChanged = (l: LineRow) => Number(edits[l.id]?.qty) !== Number(l.qty);
  const rateChanged = (l: LineRow) => Number(edits[l.id]?.rate) !== Number(l.rate);
  /** The replacement request, or null while any value is invalid or nothing changed (one change per line). */
  function correctionRequest() {
    const lines = [];
    let changed = false;
    for (const l of data.lines) {
      const e = edits[l.id];
      if (!e || !DECIMAL.test(e.qty) || !DECIMAL.test(e.rate)) return null;
      if (!(Number(e.qty) > 0) || !(Number(e.rate) > 0)) return null;
      if (qtyChanged(l) && rateChanged(l)) return null;
      changed ||= qtyChanged(l) || rateChanged(l);
      lines.push({
        originalLineId: l.id,
        itemId: l.itemId,
        qty: e.qty,
        rate: e.rate,
        uom: l.uom ?? l.itemUom ?? '',
        toWarehouseId: l.toWarehouseId as string,
      });
    }
    return changed
      ? {
          mode: 'receipt_replace',
          sourceType: 'stock_receipt',
          sourceId: entry.id,
          replacement: { lines },
        }
      : null;
  }
  const anyRateChange = $derived(data.lines.some((l) => rateChanged(l)));
  const lineName = (id: string) => data.lines.find((l) => l.id === id)?.itemLabel;

  let busy = $state(false);
  let err = $state<string | null>(null);
  let confirmCancelOpen = $state(false);
  let attachmentsRefreshKey = $state(0);

  async function errMessage(res: Response): Promise<string> {
    try {
      const body = await res.json();
      // Lock refusals (spec 140) name every rule that applies.
      if (Array.isArray(body?.locks) && body.locks.length)
        return `${body.error}: ${body.locks.map(lockReason).join(' · ')}`;
      return body?.message ?? body?.error ?? m.stock_submit_failed();
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
      else {
        const r = stockRefusal(await res.json().catch(() => null), entry.type);
        err = r.detail ? `${r.title} ${r.detail}` : r.title;
      }
    } finally {
      busy = false;
    }
  }

  const lineColumns: DataColumn<LineRow>[] = [
    { key: 'item', label: m.stock_field_item(), accessor: (l) => l.itemLabel },
    {
      key: 'qty',
      label: m.stock_field_qty(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (l) => Number(l.qty),
    },
    {
      key: 'rate',
      label: m.stock_field_rate(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (l) => (l.rate != null ? Number(l.rate) : null),
    },
    {
      key: 'fromWarehouse',
      label: m.stock_field_from_warehouse(),
      accessor: (l) => l.fromWarehouseName ?? '—',
    },
    {
      key: 'toWarehouse',
      label: m.stock_field_to_warehouse(),
      accessor: (l) => l.toWarehouseName ?? '—',
    },
  ];

  // Canje (spec 142): two tables — what left ("Entregas") and what came in
  // ("Recibes") — with the unit cost submit wrote on each line and its value.
  const isExchange = $derived(entry.type === 'exchange');
  const isOut = (l: LineRow) => !!l.fromWarehouseId;
  const lineValue = (l: LineRow) => (l.rate != null ? Number(l.qty) * Number(l.rate) : null);
  const exchangeColumns: DataColumn<LineRow>[] = [
    { key: 'item', label: m.stock_field_item(), accessor: (l) => l.itemLabel },
    {
      key: 'qty',
      label: m.stock_field_qty(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (l) => Number(l.qty),
    },
    {
      key: 'rate',
      label: m.stock_exchange_unit_cost(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: (l) => (l.rate != null ? Number(l.rate) : null),
    },
    {
      key: 'value',
      label: m.stock_col_value(),
      align: 'right',
      numeric: true,
      custom: true,
      accessor: lineValue,
    },
  ];

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
    {#snippet leading()}<ArrowLeftRight
        size={iconSizes.md}
        class="text-accent shrink-0"
      />{/snippet}
    {#snippet actions()}
      {#if !inPeek()}
        <Button variant="outline" size="sm" onclick={() => history.back()}
          ><ArrowLeft size={iconSizes.sm} /> {m.common_back()}</Button
        >
      {/if}
      {#if entry.status === 'draft'}
        <Button
          variant="primary"
          size="sm"
          onclick={submitEntry}
          disabled={busy || !canAct('stock', 'edit')}
          loading={busy}
          title={canAct('stock', 'edit') ? undefined : m.no_permission()}>{m.stock_submit()}</Button
        >
      {:else if entry.status === 'submitted'}
        {#if canCorrect}
          <Button
            variant="outline"
            size="sm"
            onclick={openCorrection}
            disabled={lock?.locked}
            title={lock?.locked ? m.record_locks_notice_disabled() : undefined}
            >{m.stock_corr_receipt_action()}</Button
          >
        {/if}
        <Button
          variant="outline"
          size="sm"
          onclick={() => (confirmCancelOpen = true)}
          disabled={busy || !canAct('stock', 'manage')}
          title={canAct('stock', 'manage') ? undefined : m.no_permission()}
          >{m.stock_cancel_entry()}</Button
        >
      {/if}
    {/snippet}
  </PageHeader>

  <div class="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-4">
    {#if err}<p class="err-msg">{err}</p>{/if}
    {#if lock && (lock.locked || lock.unlock)}
      <LockNotice {lock} recordId={entry.id} isOwner={data.isOwner} />
    {/if}
    {#if data.replacementEntryId}
      <p class="t-caption" role="status">
        {m.stock_corr_receipt_replaced()}
        <a class="card-link" href={`/stock/entries/${data.replacementEntryId}`}
          >{m.stock_corr_receipt_replacement_link()}</a
        >
      </p>
    {/if}
    {#if correctedFrom}
      <p class="t-caption" role="status">
        {m.stock_corr_receipt_replaces()}
        <a class="card-link" href={`/stock/entries/${correctedFrom}`}
          >{m.stock_corr_receipt_original_link()}</a
        >
      </p>
    {/if}
    <div class="card">
      <dl class="meta-grid">
        <dt>{m.stock_col_status()}</dt>
        <dd><Badge variant={statusV.variant} value={statusV.value}>{statusLabel}</Badge></dd>
        <dt>{m.stock_col_party()}</dt>
        <dd>{data.partyName ?? m.stock_no_party()}</dd>
        <dt>{m.stock_field_note()}</dt>
        <dd>{entry.note ?? '—'}</dd>
        <dt>{m.stock_col_created()}</dt>
        <dd>{new Date(entry.createdAt).toLocaleString(appLocale())}</dd>
        {#if entry.postedAt}<dt>{m.stock_col_posted_at()}</dt>
          <dd>{new Date(entry.postedAt).toLocaleString(appLocale())}</dd>{/if}
      </dl>
    </div>

    {#if isExchange}
      {#each [{ out: true, title: m.stock_exchange_out() }, { out: false, title: m.stock_exchange_in() }] as sec (sec.out)}
        <div class="card">
          <div class="card-h">{sec.title}</div>
          <DataTable
            variant="plain"
            data={data.lines.filter((l) => isOut(l) === sec.out)}
            columns={exchangeColumns}
            getRowId={(l) => l.id}
          >
            {#snippet cell(row: LineRow, col: DataColumn<LineRow>)}
              {@const sign = sec.out ? '−' : '+'}
              {@const value = lineValue(row)}
              {#if col.key === 'qty'}
                <span class="tabular-nums">{sign}{formatNumber(Number(row.qty))}</span>
              {:else if col.key === 'rate'}
                <span class="tabular-nums">{row.rate != null ? formatMoney(row.rate) : '—'}</span>
              {:else if col.key === 'value'}
                <span class="tabular-nums"
                  >{value != null ? `${sign}${formatMoney(value)}` : '—'}</span
                >
              {/if}
            {/snippet}
          </DataTable>
        </div>
      {/each}
    {:else}
      <div class="card">
        <div class="card-h">{m.stock_entry_lines_title()}</div>
        <!-- TODO(handoff): the sideways-page overflow this card showed was fixed in
             DataTable (plain variant now owns an overflow-x scroller); no browser
             check was possible from the authoring worktree (the :5199 dev server
             serves another branch), so the visual pass — lines table scrolling
             inside its card at <780px, and sticky `thead` in every other
             plain-variant table — is still owed. See
             proposals/2026-09-25-hub-stock-inline-tags-uom-overflow.md. -->
        <DataTable variant="plain" data={data.lines} columns={lineColumns} getRowId={(l) => l.id}>
          {#snippet cell(row: LineRow, col: DataColumn<LineRow>)}
            {#if col.key === 'qty'}
              <span class="tabular-nums">{formatNumber(Number(row.qty))}</span>
            {:else if col.key === 'rate'}
              <span class="tabular-nums">{row.rate != null ? formatMoney(row.rate) : '—'}</span>
            {/if}
          {/snippet}
        </DataTable>
      </div>
    {/if}

    <div class="card">
      <div class="card-h flex items-center justify-between gap-2">
        <span>{m.attachments_title()}</span>
        <AttachmentButton
          objectType="stk_entry"
          objectId={entry.id}
          size="sm"
          hint="tooltip"
          disabled={!canAct('stock', 'edit')}
          onuploaded={() => (attachmentsRefreshKey += 1)}
        />
      </div>
      <AttachmentList
        objectType="stk_entry"
        objectId={entry.id}
        refreshKey={attachmentsRefreshKey}
      />
    </div>
  </div>
</div>

<Modal bind:open={correcting} title={m.stock_corr_receipt_title()} size="md">
  <div class="corr-form">
    <p class="t-caption">{m.stock_corr_receipt_note()}</p>
    {#each data.lines as l (l.id)}
      <div class="corr-line">
        <span class="t-label">{l.itemLabel}</span>
        <Input
          size="sm"
          type="text"
          inputmode="decimal"
          label={m.stock_corr_receipt_qty()}
          bind:value={edits[l.id].qty}
          disabled={rateChanged(l)}
        />
        <Input
          size="sm"
          type="text"
          inputmode="decimal"
          label={m.stock_corr_receipt_rate()}
          bind:value={edits[l.id].rate}
          disabled={qtyChanged(l)}
        />
      </div>
    {/each}
    {#if anyRateChange}<p class="t-caption">{m.stock_corr_receipt_owner_only()}</p>{/if}
    {#if correctionRequest() === null}
      <p class="t-caption">{m.stock_corr_receipt_nochange()}</p>
    {/if}
    <CorrectionFlow
      scope={{
        orgId: page.data.activeOrgId ?? '',
        profileId: page.data.user?.supabaseId ?? '',
        sourceType: 'stock_receipt',
        sourceId: entry.id,
      }}
      previewUrl="/api/stock/corrections/preview"
      applyUrl="/api/stock/corrections"
      previewBody={(reason) => {
        const request = correctionRequest();
        return request ? { request, reason } : null;
      }}
      applyBody={(a) => ({ request: correctionRequest(), ...a })}
      itemLabel={(id) => data.lines.find((l) => l.itemId === id)?.itemLabel}
      lineLabel={lineName}
      costExpected
      onapplied={async (source) => {
        if (source === 'post') correcting = false;
        await invalidate('stock:entry-detail');
      }}
    />
  </div>
</Modal>

<Modal bind:open={confirmCancelOpen} title={m.stock_confirm_cancel_title()}>
  <p>{m.stock_confirm_cancel_body()}</p>
  {#snippet footer()}
    <Button variant="outline" size="sm" onclick={() => (confirmCancelOpen = false)}
      >{m.common_cancel()}</Button
    >
    <Button variant="primary" size="sm" onclick={cancelEntry} disabled={busy} loading={busy}
      >{m.common_confirm()}</Button
    >
  {/snippet}
</Modal>

<style>
  .card {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    padding: var(--space-3) var(--space-4);
  }
  .card-h {
    font-size: var(--font-size-body);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--color-muted-foreground);
    margin-bottom: var(--space-3);
  }
  .meta-grid {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: var(--space-2) var(--space-4);
    font-size: var(--font-size-body);
    align-items: center;
  }
  .meta-grid dt {
    color: var(--color-muted-foreground);
  }
  .corr-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .corr-line {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2);
    align-items: end;
  }
  .corr-line > :first-child {
    grid-column: 1 / -1;
  }
  .card-link {
    color: var(--color-accent);
    text-decoration: none;
  }
  .card-link:hover,
  .card-link:focus-visible {
    text-decoration: underline;
  }
  .err-msg {
    font-size: var(--font-size-body);
    color: var(--color-destructive);
  }
</style>
