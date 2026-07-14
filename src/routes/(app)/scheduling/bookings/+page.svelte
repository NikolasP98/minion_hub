<script lang="ts">
  import type { PageData } from './$types';
  import { CalendarClock, Plus, Check, X, UserX, ClipboardList } from 'lucide-svelte';
  import { invalidate, goto } from '$app/navigation';
  import { PageHeader, Card, Button, Badge, EmptyState, Modal, Select } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import ScopeBanner from '$lib/components/crm/ScopeBanner.svelte';
  import ConsumptionGauge from '$lib/components/stock/ConsumptionGauge.svelte';
  import { gaugeMax } from '$lib/components/stock/stock-ui';
  import { canAct } from '$lib/access/can.svelte';

  let { data }: { data: PageData } = $props();

  const resourceName = (id: string) => data.resources.find((r) => r.id === id)?.name ?? '—';
  const eventTitle = (id: string) => data.eventTypes.find((e) => e.id === id)?.title ?? '—';

  const STATUS_LABEL: Record<string, () => string> = {
    accepted: () => m.sched_status_accepted(),
    pending: () => m.sched_status_pending(),
    cancelled: () => m.sched_status_cancelled(),
    rejected: () => m.sched_status_rejected(),
    completed: () => m.sched_status_completed(),
    no_show: () => m.sched_status_no_show(),
  };

  function fmt(d: string | Date): string {
    const dt = typeof d === 'string' ? new Date(d) : d;
    return dt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  async function setStatus(id: string, status: string) {
    await fetch(`/api/scheduling/bookings/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    await invalidate('scheduling:data');
  }

  const accrualBySource = $derived(new Map(data.accrualSummaries.map((s) => [s.sourceId, s])));

  // ── Complete dialog ──
  let completeFor = $state<string | null>(null); // booking id
  let cdLines = $state<ConsumptionLine[]>([]);
  let cdBusy = $state(false);
  let stockWarnings = $state<Record<string, string>>({}); // bookingId → message

  async function openComplete(id: string) {
    const summary = accrualBySource.get(id);
    if (!summary || summary.open === 0) {
      await completeBooking(id, null); // no accruals → one-click complete
      return;
    }
    const res = await fetch(`/api/stock/accruals?source=booking&sourceId=${id}&status=open`);
    const j = res.ok ? await res.json() : { accruals: [] };
    cdLines = (j.accruals ?? []).map((a: Record<string, unknown>) => ({
      itemId: a.itemId as string,
      itemName: a.itemName as string,
      uom: a.itemUom as string,
      qty: Number(a.qty),
      qtyConsumption: Number(a.qtyConsumption),
      consumptionUom: (a.consumptionUom as string | null) ?? null,
      unitsPerStockUom: a.unitsPerStockUom == null ? null : Number(a.unitsPerStockUom),
      subunitsPerStockUom: a.subunitsPerStockUom == null ? null : Number(a.subunitsPerStockUom),
      diagramEnabled: Boolean(a.diagramEnabled),
      available: 0,
      committedOther: 0,
      atp: 0,
    }));
    completeFor = id;
  }

  async function completeBooking(id: string, lines: ConsumptionLine[] | null) {
    cdBusy = true;
    try {
      // positive-filter, same principle as book(): a gauge dragged to 0 must not
      // block the whole completion — drop non-positive lines, or send null.
      const positiveLines = lines?.filter((l) => l.qtyConsumption > 0) ?? null;
      const res = await fetch(`/api/scheduling/bookings/${id}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          lines: positiveLines?.length
            ? positiveLines.map((l) => ({
                itemId: l.itemId,
                qty: l.qty,
                qtyConsumption: l.qtyConsumption,
              }))
            : null,
        }),
      });
      if (!res.ok) {
        stockWarnings = { ...stockWarnings, [id]: `complete failed (${res.status})` };
        completeFor = null;
        return;
      }
      const j = await res.json();
      if (j?.stockWarning)
        stockWarnings = { ...stockWarnings, [id]: j.stockWarning.message as string };
      else {
        const next = { ...stockWarnings };
        delete next[id];
        stockWarnings = next;
      }
      completeFor = null;
      await invalidate('scheduling:data');
    } finally {
      cdBusy = false;
    }
  }

  // Booking → Sales Order: map this appointment into a commitment-to-bill and
  // jump to the Sales view. Idempotent server-side (one order per booking).
  let orderBusy = $state<string | null>(null);
  async function createOrder(id: string) {
    orderBusy = id;
    try {
      const res = await fetch(`/api/scheduling/bookings/${id}/order`, { method: 'POST' });
      if (res.ok) await goto('/sales');
    } finally {
      orderBusy = null;
    }
  }

  // ── New appointment modal ── (opened pre-bound from the Connections "+New")
  // svelte-ignore state_referenced_locally
  let showNew = $state(data.openNew ?? false);
  let nbEventType = $state('');
  let nbDate = $state(new Date().toISOString().slice(0, 10));
  let nbSlots = $state<Array<{ start: string; end: string }>>([]);
  let nbSlot = $state('');
  // svelte-ignore state_referenced_locally
  let nbName = $state(data.contactName ?? '');
  let nbPhone = $state('');
  let nbLoading = $state(false);
  let nbErr = $state<string | null>(null);

  // Optional link to an existing CRM contact (better traceability than phone-match).
  // svelte-ignore state_referenced_locally
  let nbContactId = $state<string | null>(data.contactId ?? null);
  // svelte-ignore state_referenced_locally
  let nbSearch = $state(data.contactName ?? '');
  let nbResults = $state<Array<{ id: string; name: string }>>([]);
  async function searchContacts() {
    nbContactId = null; // typing a new query unpicks any prior choice
    const q = nbSearch.trim();
    if (q.length < 2) {
      nbResults = [];
      return;
    }
    const res = await fetch(`/api/crm/contacts?search=${encodeURIComponent(q)}&limit=8`);
    const j = res.ok ? await res.json() : { contacts: [] };
    nbResults = (j.contacts ?? []).map(
      (c: { contact_id: string; display_name: string | null }) => ({
        id: c.contact_id,
        name: c.display_name || '—',
      }),
    );
  }
  // ── Stock consumption preview (Task 9) ──
  type ConsumptionLine = {
    itemId: string;
    itemName: string;
    uom: string;
    qty: number;
    qtyConsumption: number;
    consumptionUom: string | null;
    unitsPerStockUom: number | null;
    subunitsPerStockUom: number | null;
    diagramEnabled: boolean;
    available: number;
    committedOther: number;
    atp: number;
  };
  let nbLines = $state<ConsumptionLine[]>([]);
  let nbHasMapping = $state(false);
  let nbGen = 0; // generation token: guards against a stale fetch overwriting a newer selection

  function setLineConsumption(l: ConsumptionLine, qtyConsumption: number) {
    l.qtyConsumption = qtyConsumption;
    l.qty = l.unitsPerStockUom ? qtyConsumption / l.unitsPerStockUom : qtyConsumption;
  }

  async function loadConsumption() {
    const gen = ++nbGen;
    nbLines = [];
    nbHasMapping = false;
    const et = data.eventTypes.find((e) => e.id === nbEventType);
    if (!et?.productId || !data.stockEnabled || !canAct('stock', 'view')) return;
    try {
      const res = await fetch('/api/stock/accruals/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ finProductId: et.productId, quantity: 1 }),
      });
      if (!res.ok) return; // no warehouse / stock off — block simply stays hidden
      const j = await res.json();
      if (gen !== nbGen) return; // a newer selection superseded this fetch
      nbHasMapping = j.preview.hasMapping;
      nbLines = j.preview.lines;
    } catch {
      /* preview is best-effort */
    }
  }

  async function pickContact(c: { id: string; name: string }) {
    nbContactId = c.id;
    nbName = c.name;
    nbSearch = c.name;
    nbResults = [];
    // fetch_from: pull the contact's phone/email and fill only what's empty.
    try {
      const res = await fetch(`/api/crm/contacts/${c.id}/prefill`);
      if (res.ok) {
        const p = await res.json();
        if (!nbPhone && p.phone) nbPhone = p.phone;
        if (!nbName && p.name) nbName = p.name;
      }
    } catch {
      /* prefill is best-effort */
    }
  }

  async function loadSlots() {
    if (!nbEventType || !nbDate) return;
    nbLoading = true;
    nbErr = null;
    nbSlot = '';
    const from = new Date(`${nbDate}T00:00:00`);
    const to = new Date(from.getTime() + 86_400_000);
    try {
      const res = await fetch(
        `/api/scheduling/slots?eventTypeId=${nbEventType}&from=${from.toISOString()}&to=${to.toISOString()}`,
      );
      if (res.ok) {
        const j = await res.json();
        nbSlots = j.slots ?? [];
      } else nbSlots = [];
    } finally {
      nbLoading = false;
    }
  }

  async function book() {
    if (!nbEventType || !nbSlot || !nbName.trim()) {
      nbErr = 'service, time and name required';
      return;
    }
    nbLoading = true;
    nbErr = null;
    try {
      // server requires qtyConsumption > 0 per line; a gauge dragged to 0 (or a typed
      // negative) must not fail the whole booking — drop non-positive lines instead.
      const positiveLines = nbHasMapping ? nbLines.filter((l) => l.qtyConsumption > 0) : [];
      const res = await fetch('/api/scheduling/bookings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventTypeId: nbEventType,
          start: nbSlot,
          attendeeName: nbName,
          attendeePhone: nbPhone || null,
          crmContactId: nbContactId,
          consumption: positiveLines.length
            ? positiveLines.map((l) => ({ itemId: l.itemId, qtyConsumption: l.qtyConsumption }))
            : null,
        }),
      });
      if (res.status === 409) {
        nbErr = m.sched_book_unavailable();
        await loadSlots();
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      showNew = false;
      nbName = '';
      nbPhone = '';
      nbSlot = '';
      nbContactId = null;
      nbSearch = '';
      nbResults = [];
      nbLines = [];
      nbHasMapping = false;
      await invalidate('scheduling:data');
    } catch (e) {
      nbErr = e instanceof Error ? e.message : 'error';
    } finally {
      nbLoading = false;
    }
  }
</script>

<svelte:head><title>{m.sched_bookings_title()} · {m.nav_scheduling()}</title></svelte:head>

<PageShell
  archetype="collection"
  scroll="region"
  labelledBy="scheduling-bookings-title"
  class="scheduling-bookings-surface"
>
  <PageHeader
    titleId="scheduling-bookings-title"
    title={m.sched_bookings_title()}
    subtitle={m.sched_dashboard_subtitle()}
  >
    {#snippet leading()}
      <CalendarClock size={16} class="text-accent shrink-0" />
    {/snippet}
    {#snippet actions()}
      <Button
        size="sm"
        onclick={() => (showNew = true)}
        disabled={data.eventTypes.length === 0 || !canAct('scheduling', 'edit')}
        title={canAct('scheduling', 'edit') ? undefined : m.no_permission()}
      >
        <Plus size={14} />
        {m.sched_bookings_title()}
      </Button>
    {/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region">
    {#if data.contactName}<div class="mb-3">
        <ScopeBanner name={data.contactName} contactId={data.contactId} noun="bookings" />
      </div>{/if}
    {#if data.bookings.length === 0}
      <EmptyState title={m.sched_empty_bookings()} />
    {:else}
      <div class="flex flex-col gap-2">
        {#each data.bookings as b (b.id)}
          <Card padding="md">
            <div class="flex items-center gap-3 flex-wrap">
              <div class="flex-1 min-w-[180px]">
                <div class="font-medium">{eventTitle(b.eventTypeId)}</div>
                <div class="t-caption">{fmt(b.startTime)} · {resourceName(b.resourceId)}</div>
              </div>
              <div class="min-w-[120px]">
                <div class="text-sm">{b.attendeeName ?? '—'}</div>
                <div class="t-caption">{b.attendeePhone ?? ''}</div>
              </div>
              <Badge>{(STATUS_LABEL[b.status] ?? (() => b.status))()}</Badge>
              {#if accrualBySource.get(b.id)}
                {@const acc = accrualBySource.get(b.id)!}
                {#if acc.open > 0}
                  <Badge variant="semantic" value="warning"
                    >{m.sched_stock_committed({ value: acc.estValue.toFixed(2) })}</Badge
                  >
                {:else if acc.realized > 0}
                  <a
                    href={acc.realizedEntryId ? `/stock/entries/${acc.realizedEntryId}` : '/stock'}
                    class="no-underline"
                  >
                    <Badge variant="semantic" value="success"
                      >{m.sched_stock_realized({ value: acc.realizedValue.toFixed(2) })}</Badge
                    >
                  </a>
                {:else}
                  <Badge>{m.sched_stock_released()}</Badge>
                {/if}
              {/if}
              {#if stockWarnings[b.id]}
                <span class="t-caption" style="color:var(--color-destructive)">
                  {stockWarnings[b.id]}
                  <Button
                    variant="ghost"
                    size="sm"
                    class="underline"
                    onclick={() => completeBooking(b.id, null)}>{m.sched_stock_retry_post()}</Button
                  >
                </span>
              {/if}
              <div class="flex gap-1">
                {#if b.status === 'accepted' || b.status === 'pending'}
                  <Button
                    variant="ghost"
                    size="sm"
                    class="act"
                    title={canAct('scheduling', 'edit')
                      ? m.sched_mark_complete()
                      : m.no_permission()}
                    disabled={!canAct('scheduling', 'edit')}
                    onclick={() => openComplete(b.id)}
                  >
                    <Check size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="act"
                    title={canAct('scheduling', 'edit') ? m.sched_mark_noShow() : m.no_permission()}
                    disabled={!canAct('scheduling', 'edit')}
                    onclick={() => setStatus(b.id, 'no_show')}
                  >
                    <UserX size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    class="act del"
                    title={canAct('scheduling', 'edit')
                      ? m.sched_cancel_booking()
                      : m.no_permission()}
                    disabled={!canAct('scheduling', 'edit')}
                    onclick={() => setStatus(b.id, 'cancelled')}
                  >
                    <X size={15} />
                  </Button>
                {/if}
                {#if b.status !== 'cancelled' && b.status !== 'rejected'}
                  <Button
                    variant="ghost"
                    size="sm"
                    class="act"
                    title={canAct('scheduling', 'edit') ? 'Create sales order' : m.no_permission()}
                    disabled={orderBusy === b.id || !canAct('scheduling', 'edit')}
                    onclick={() => createOrder(b.id)}
                  >
                    <ClipboardList size={15} />
                  </Button>
                {/if}
              </div>
            </div>
          </Card>
        {/each}
      </div>
    {/if}
  </PageBody>
</PageShell>

<Modal bind:open={showNew} title={m.sched_bookings_title()} onclose={() => (showNew = false)}>
  <div class="flex flex-col gap-3">
    <label class="field">
      <span class="t-caption">{m.sched_book_choose_service()}</span>
      <Select
        class="txt"
        bind:value={nbEventType}
        onchange={() => {
          loadSlots();
          loadConsumption();
        }}
      >
        <option value="">—</option>
        {#each data.eventTypes as e (e.id)}
          <option value={e.id}>{e.title}</option>
        {/each}
      </Select>
    </label>
    <label class="field">
      <span class="t-caption">{m.sched_book_pick_time()}</span>
      <input class="txt" type="date" bind:value={nbDate} onchange={loadSlots} />
    </label>
    {#if nbLoading}
      <p class="t-caption">…</p>
    {:else if nbEventType && nbSlots.length === 0}
      <p class="t-caption">{m.sched_book_no_slots()}</p>
    {:else if nbSlots.length}
      <div class="slot-grid">
        {#each nbSlots as s (s.start)}
          <Button
            variant="ghost"
            size="sm"
            type="button"
            class="slot {nbSlot === s.start ? 'slot-on' : ''}"
            onclick={() => (nbSlot = s.start)}
          >
            {new Date(s.start).toLocaleTimeString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </Button>
        {/each}
      </div>
    {/if}
    {#if nbHasMapping && nbLines.length}
      <div class="field">
        <span class="t-caption">{m.sched_stock_consumption()}</span>
        <div class="flex flex-col gap-2">
          {#each nbLines as l (l.itemId)}
            {@const gMax = l.diagramEnabled
              ? gaugeMax({
                  uom: l.uom,
                  unitsPerStockUom: l.unitsPerStockUom,
                  subunitsPerStockUom: l.subunitsPerStockUom,
                })
              : 0}
            <div class="flex items-center gap-3 flex-wrap">
              <span class="text-sm min-w-[120px]">{l.itemName}</span>
              {#if gMax > 0}
                <ConsumptionGauge
                  max={gMax}
                  unit={l.consumptionUom ?? l.uom}
                  bind:value={() => l.qtyConsumption ?? 0, (v) => setLineConsumption(l, v)}
                />
              {:else}
                <input
                  class="txt"
                  style="max-width: 90px"
                  type="number"
                  min="0"
                  step="any"
                  value={l.qtyConsumption}
                  oninput={(e) => setLineConsumption(l, Number(e.currentTarget.value) || 0)}
                />
                <span class="t-caption">{l.consumptionUom ?? l.uom}</span>
              {/if}
              {#if l.qty > l.atp}
                <span class="t-caption" style="color:var(--color-destructive)"
                  >{m.sched_stock_atp_warn({ atp: String(l.atp), uom: l.uom })}</span
                >
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/if}
    <div class="field">
      <span class="t-caption">{m.sched_book_find_client()}</span>
      <div class="search-wrap">
        <input
          class="txt"
          bind:value={nbSearch}
          oninput={searchContacts}
          placeholder={m.sched_book_find_client_ph()}
        />
        {#if nbContactId}<span class="linked">✓ {m.sched_book_linked()}</span>{/if}
        {#if nbResults.length}
          <div class="results">
            {#each nbResults as c (c.id)}
              <Button
                variant="ghost"
                size="sm"
                type="button"
                class="result"
                onclick={() => pickContact(c)}>{c.name}</Button
              >
            {/each}
          </div>
        {/if}
      </div>
    </div>
    <label class="field">
      <span class="t-caption">{m.sched_book_name()}</span>
      <input class="txt" bind:value={nbName} />
    </label>
    {#if !nbContactId}
      <label class="field">
        <span class="t-caption">{m.sched_book_phone()}</span>
        <input class="txt" bind:value={nbPhone} />
      </label>
    {/if}
    {#if nbErr}<p class="t-caption" style="color:var(--color-destructive)">{nbErr}</p>{/if}
    <div class="flex gap-2">
      <Button
        onclick={book}
        disabled={nbLoading || !nbSlot || !nbName.trim() || !canAct('scheduling', 'edit')}
        title={canAct('scheduling', 'edit') ? undefined : m.no_permission()}
        >{m.sched_book_confirm()}</Button
      >
      <Button variant="ghost" onclick={() => (showNew = false)}>{m.sched_cancel()}</Button>
    </div>
  </div>
</Modal>

<Modal
  open={completeFor !== null}
  title={m.sched_complete_title()}
  onclose={() => (completeFor = null)}
>
  <div class="flex flex-col gap-3">
    <p class="t-caption">{m.sched_complete_hint()}</p>
    {#each cdLines as l (l.itemId)}
      {@const gMax = l.diagramEnabled
        ? gaugeMax({
            uom: l.uom,
            unitsPerStockUom: l.unitsPerStockUom,
            subunitsPerStockUom: l.subunitsPerStockUom,
          })
        : 0}
      <div class="flex items-center gap-3 flex-wrap">
        <span class="text-sm min-w-[120px]">{l.itemName}</span>
        {#if gMax > 0}
          <ConsumptionGauge
            max={gMax}
            unit={l.consumptionUom ?? l.uom}
            bind:value={() => l.qtyConsumption ?? 0, (v) => setLineConsumption(l, v)}
          />
        {:else}
          <input
            class="txt"
            style="max-width: 90px"
            type="number"
            min="0"
            step="any"
            value={l.qtyConsumption}
            oninput={(e) => setLineConsumption(l, Number(e.currentTarget.value) || 0)}
          />
          <span class="t-caption">{l.consumptionUom ?? l.uom}</span>
        {/if}
      </div>
    {/each}
    <div class="flex gap-2">
      <Button disabled={cdBusy} onclick={() => completeFor && completeBooking(completeFor, cdLines)}
        >{m.sched_complete_confirm()}</Button
      >
      <Button variant="ghost" onclick={() => (completeFor = null)}>{m.sched_cancel()}</Button>
    </div>
  </div>
</Modal>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
  }
  .txt {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: var(--space-2, 8px) var(--space-2, 8px);
    background: var(--color-card);
    font-size: var(--font-size-body, 14px);
    width: 100%;
  }
  .slot-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: var(--space-2, 8px);
    max-height: 200px;
    overflow: auto;
  }
  .slot {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-sm);
    padding: var(--space-1, 4px);
    font-size: var(--font-size-body, 14px);
    background: var(--color-card);
  }
  .slot-on {
    background: var(--accent);
    color: var(--color-on-accent);
    border-color: var(--accent);
  }
  .search-wrap {
    position: relative;
  }
  .linked {
    font-size: var(--font-size-caption, 12px);
    color: var(--accent);
  }
  .results {
    position: absolute;
    z-index: var(--layer-sticky, 10);
    left: 0;
    right: 0;
    top: 100%;
    margin-top: var(--space-0-5, 2px);
    background: var(--color-card);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-raised);
    max-height: 180px;
    overflow: auto;
  }
  .result {
    display: block;
    width: 100%;
    text-align: left;
    padding: var(--space-2, 8px) var(--space-2, 8px);
    font-size: var(--font-size-body, 14px);
  }
  .result:hover {
    background: var(--hairline);
  }
  .act {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--color-muted-foreground);
    border-radius: var(--radius-sm);
    padding: var(--space-1, 4px);
  }
  .act:hover {
    background: var(--hairline);
  }
  .act.del:hover {
    color: var(--color-destructive);
  }
</style>
