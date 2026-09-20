<script lang="ts">
  /**
   * Client account drawer (spec `2026-09-13-pos-scheduling-packages-payment-plans`
   * §4.2) — one client's stored value, package grants and instalment plans.
   * Reads `GET /api/pos/accounts/[clientKey]`; writes through
   * `POST /api/pos/accounts/topup`, `DELETE /api/pos/packages/grants/[id]` and
   * `DELETE /api/pos/plans/[id]`.
   *
   * Same foundation and structure as BookingDetailDrawer: `Sheet` (native
   * `<dialog showModal>`) owns backdrop + Escape dismissal.
   */
  import { CalendarPlus, PlusCircle, Trash2 } from 'lucide-svelte';
  import { Badge, Button, EmptyState, Input, Spinner, iconSizes } from '$lib/components/ui';
  import { Sheet } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import { formatDate, formatMoney } from '$lib/utils/format';
  import { canAct, canViewPath } from '$lib/access/can.svelte';
  import PlanOpenForm from './PlanOpenForm.svelte';
  import AppointmentForm, {
    type AppointmentEventType,
    type AppointmentResource,
  } from '$lib/components/scheduling/AppointmentForm.svelte';

  /**
   * Serialized `GET /api/pos/accounts/[clientKey]` — a client component must not
   * import from `$server`, and `json()` turns every Date into an ISO string.
   */
  type Detail = {
    client: { partyId?: string | null; crmContactId?: string | null };
    balance: number;
    ledger: Array<{
      id: string;
      kind: string;
      amount: string;
      currency: string;
      note: string | null;
      createdAt: string;
    }>;
    grants: Array<{
      grant: {
        id: string;
        packageProductId: string;
        serviceProductId: string;
        sessionsTotal: number;
        unitValue: string;
        expiresAt: string | null;
      };
      sessionsUsed: number;
      sessionsRemaining: number;
      status: string;
    }>;
    plans: Array<{
      plan: {
        id: string;
        title: string;
        totalAmount: string;
        currency: string;
        status: string;
      };
      paidToDate: number;
      remaining: number;
      isPaid: boolean;
    }>;
  };

  type Props = {
    /** `contact:<uuid>` / `party:<uuid>`; non-null opens the drawer and fetches. */
    clientKey: string | null;
    clientName?: string | null;
    /** fin_products.id → name, so grants never render a raw uuid. */
    productNames?: Record<string, string>;
    /** "Draw session" form data — same shape `/pos/appointments/new` loads. */
    eventTypes?: AppointmentEventType[];
    resources?: AppointmentResource[];
    stockEnabled?: boolean;
    pendingScheduling?: number;
    pendingTicketId?: string | null;
    onclose: () => void;
    /** Fired after any mutation so the host can `invalidate()` its list. */
    onchanged?: () => void | Promise<void>;
  };

  let {
    clientKey,
    clientName = null,
    productNames = {},
    eventTypes = [],
    resources = [],
    stockEnabled = false,
    pendingScheduling = 0,
    pendingTicketId = null,
    onclose,
    onchanged,
  }: Props = $props();

  let detail = $state<Detail | null>(null);
  let loading = $state(false);
  let err = $state<string | null>(null);
  let busy = $state(false);

  let topupOpen = $state(false);
  let topupAmount = $state('');
  let topupNote = $state('');
  let planOpen = $state(false);
  /** id of the grant currently drawing a session, or null. */
  let drawGrantId = $state<string | null>(null);

  const canManage = $derived(canAct('pos', 'manage'));
  // Opening a plan is ordinary POS creation work — it moves no money.
  const canCreate = $derived(canAct('pos', 'create'));

  let gen = 0;
  async function reload(): Promise<void> {
    const key = clientKey;
    if (!key) return;
    const token = ++gen;
    loading = true;
    err = null;
    try {
      const res = await fetch(`/api/pos/accounts/${encodeURIComponent(key)}`);
      if (token !== gen) return; // a newer open superseded this fetch
      if (!res.ok) throw new Error(String(res.status));
      const d: Detail = await res.json();
      detail = d;
    } catch (e) {
      if (token !== gen) return;
      detail = null;
      err = e instanceof Error ? e.message : 'error';
    } finally {
      if (token === gen) loading = false;
    }
  }

  $effect(() => {
    if (!clientKey) {
      gen++;
      detail = null;
      err = null;
      return;
    }
    topupOpen = false;
    topupAmount = '';
    topupNote = '';
    planOpen = false;
    drawGrantId = null;
    void reload();
  });

  const LEDGER_KIND: Record<string, () => string> = {
    topup: () => m.pos_acct_kind_topup(),
    deposit: () => m.pos_acct_kind_deposit(),
    redemption: () => m.pos_acct_kind_redemption(),
    refund: () => m.pos_acct_kind_refund(),
    adjustment: () => m.pos_acct_kind_adjustment(),
  };
  const GRANT_STATUS: Record<string, () => string> = {
    active: () => m.pos_pkg_status_active(),
    exhausted: () => m.pos_pkg_status_exhausted(),
    expired: () => m.pos_pkg_status_expired(),
    cancelled: () => m.pos_pkg_status_cancelled(),
  };
  /** One fixed semantic ramp — the same hue on every surface (governance §ramp). */
  const GRANT_TONE: Record<string, 'success' | 'warning' | 'error'> = {
    active: 'success',
    exhausted: 'warning',
    expired: 'warning',
    cancelled: 'error',
  };
  const PLAN_STATUS: Record<string, () => string> = {
    open: () => m.pos_plan_status_open(),
    settled: () => m.pos_plan_status_settled(),
    cancelled: () => m.pos_plan_status_cancelled(),
  };

  const productName = (id: string) => productNames[id] ?? id;
  const fmtDateTime = (iso: string) =>
    formatDate(iso, { dateStyle: 'medium', timeStyle: 'short', hour12: false });

  /** Business-rule codes reach the UI as words, never as `package_in_use`. */
  function messageFor(code: string | undefined, fallback: string): string {
    if (code === 'package_in_use') return m.pos_pkg_in_use();
    if (code === 'plan_settled') return m.pos_plan_settled_err();
    if (code === 'insufficient_credit') return m.pos_acct_insufficient_credit();
    return fallback;
  }

  async function send(url: string, init: RequestInit): Promise<boolean> {
    busy = true;
    err = null;
    try {
      const res = await fetch(url, init);
      const j = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!res.ok) {
        err = messageFor(j.code, j.error ?? m.pos_acct_action_failed());
        return false;
      }
      await reload();
      await onchanged?.();
      return true;
    } catch (e) {
      err = e instanceof Error ? e.message : m.pos_acct_action_failed();
      return false;
    } finally {
      busy = false;
    }
  }

  async function addCredit() {
    const amount = Number(topupAmount);
    if (!detail || !(amount > 0)) return;
    const ok = await send('/api/pos/accounts/topup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        partyId: detail.client.partyId ?? null,
        crmContactId: detail.client.crmContactId ?? null,
        amount,
        kind: 'topup',
        note: topupNote || null,
      }),
    });
    if (ok) {
      topupOpen = false;
      topupAmount = '';
      topupNote = '';
    }
  }

  async function cancelGrant(id: string) {
    if (!confirm(m.pos_pkg_cancel_confirm())) return;
    await send(`/api/pos/packages/grants/${id}`, { method: 'DELETE' });
  }

  async function cancelPlan(id: string) {
    if (!confirm(m.pos_plan_cancel_confirm())) return;
    await send(`/api/pos/plans/${id}`, { method: 'DELETE' });
  }
</script>

<Sheet
  open={clientKey !== null}
  title={clientName ?? m.pos_acct_drawer_title()}
  size="lg"
  placement="right"
  {onclose}
>
  {#if loading && !detail}
    <div class="center"><Spinner /></div>
  {:else if !detail}
    <EmptyState title={err ?? m.pos_acct_not_found()} />
  {:else}
    {@const d = detail}
    <div class="drawer">
      {#if pendingScheduling > 0}
        <section class="blk">
          <h4 class="t-label">{m.pos_acct_col_pending_sched()}</h4>
          <Badge variant="semantic" value="warning">{pendingScheduling}</Badge>
          {#if pendingTicketId && canViewPath('/pos/sell')}
            <a href={`/pos/sell?step=schedule&ticket=${pendingTicketId}`} onclick={onclose}>
              {m.pos_acct_pending_sched_resume()}
            </a>
          {/if}
        </section>
      {/if}
      <section class="blk">
        <div class="head-row">
          <span class="t-caption">{m.pos_acct_balance()}</span>
          <span class="t-title balance">{formatMoney(d.balance)}</span>
        </div>
        {#if canManage}
          {#if topupOpen}
            <div class="form">
              <Input
                size="sm"
                type="number"
                min="0"
                step="0.01"
                placeholder={m.pos_acct_topup_amount()}
                bind:value={topupAmount}
              />
              <Input size="sm" placeholder={m.pos_acct_topup_note()} bind:value={topupNote} />
              <Button size="sm" disabled={busy || !(Number(topupAmount) > 0)} onclick={addCredit}>
                {m.pos_acct_topup_confirm()}
              </Button>
              <Button size="sm" variant="ghost" onclick={() => (topupOpen = false)}>
                {m.common_cancel()}
              </Button>
            </div>
          {:else}
            <div class="row">
              <Button size="sm" variant="outline" onclick={() => (topupOpen = true)}>
                <PlusCircle size={iconSizes.sm} />{m.pos_acct_topup()}
              </Button>
            </div>
          {/if}
        {/if}
      </section>

      <!-- Package grants: sessions left, expiry, and what they buy -->
      <section class="blk">
        <h4 class="t-label">{m.pos_pkg_section()}</h4>
        {#if d.grants.length === 0}
          <p class="t-caption dim">{m.pos_pkg_empty()}</p>
        {:else}
          <ul class="rows">
            {#each d.grants as g (g.grant.id)}
              <li class="row wrap">
                <Badge variant="semantic" value={GRANT_TONE[g.status] ?? 'warning'}>
                  {(GRANT_STATUS[g.status] ?? (() => g.status))()}
                </Badge>
                <span class="grow">{productName(g.grant.serviceProductId)}</span>
                <span class="t-caption">
                  {m.pos_pkg_sessions({
                    remaining: String(g.sessionsRemaining),
                    total: String(g.grant.sessionsTotal),
                  })}
                </span>
                <span class="t-caption">
                  {g.grant.expiresAt
                    ? m.pos_pkg_expires({ date: g.grant.expiresAt })
                    : m.pos_pkg_no_expiry()}
                </span>
                <span class="t-caption">
                  {m.pos_pkg_unit_value({ value: formatMoney(g.grant.unitValue) })}
                </span>
                {#if canManage && g.status === 'active'}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onclick={() => (drawGrantId = g.grant.id)}
                  >
                    <CalendarPlus size={iconSizes.xs} />{m.pos_pkg_draw()}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={m.pos_pkg_cancel()}
                    title={m.pos_pkg_cancel()}
                    onclick={() => cancelGrant(g.grant.id)}
                  >
                    <Trash2 size={iconSizes.xs} />
                  </Button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
        {#if drawGrantId}
          {#key drawGrantId}
            {@const drawGrant = d.grants.find((g) => g.grant.id === drawGrantId)}
            {#if drawGrant}
              {@const drawEventTypeId =
                eventTypes.find((e) => e.productId === drawGrant.grant.serviceProductId)?.id ?? ''}
              <div class="draw-form">
                <AppointmentForm
                  {eventTypes}
                  {resources}
                  initialEventTypeId={drawEventTypeId}
                  initialPartyId={d.client.partyId}
                  initialCustomerName={clientName ?? m.pos_acct_unnamed()}
                  lockCustomer
                  bookPayload={{
                    packageGrantId: drawGrant.grant.id,
                    partyId: d.client.partyId ?? null,
                    crmContactId: d.client.crmContactId ?? null,
                  }}
                  onbooked={async () => {
                    drawGrantId = null;
                    await reload();
                    await onchanged?.();
                  }}
                  oncancel={() => (drawGrantId = null)}
                />
              </div>
            {/if}
          {/key}
        {/if}
      </section>

      <!-- Instalment plans: paid to date vs remaining (both derived server-side) -->
      <section class="blk">
        <h4 class="t-label">{m.pos_plan_section()}</h4>
        {#if d.plans.length === 0}
          <p class="t-caption dim">{m.pos_plan_empty()}</p>
        {:else}
          <ul class="rows">
            {#each d.plans as p (p.plan.id)}
              <li class="row wrap">
                <Badge
                  variant="semantic"
                  value={p.plan.status === 'open' ? 'info' : p.isPaid ? 'success' : 'error'}
                >
                  {(PLAN_STATUS[p.plan.status] ?? (() => p.plan.status))()}
                </Badge>
                <span class="grow">{p.plan.title}</span>
                <span class="t-caption">
                  {m.pos_plan_paid({
                    paid: formatMoney(p.paidToDate, p.plan.currency),
                    total: formatMoney(p.plan.totalAmount, p.plan.currency),
                  })}
                </span>
                <span class="t-caption">
                  {m.pos_plan_remaining({ value: formatMoney(p.remaining, p.plan.currency) })}
                </span>
                {#if canManage && p.plan.status === 'open'}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={m.pos_plan_cancel()}
                    title={m.pos_plan_cancel()}
                    onclick={() => cancelPlan(p.plan.id)}
                  >
                    <Trash2 size={iconSizes.xs} />
                  </Button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
        {#if planOpen}
          <PlanOpenForm
            partyId={d.client.partyId}
            crmContactId={d.client.crmContactId}
            oncreated={async () => {
              planOpen = false;
              await reload();
              await onchanged?.();
            }}
            oncancel={() => (planOpen = false)}
          />
        {:else}
          <div class="row">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !canCreate}
              title={canCreate ? undefined : m.no_permission()}
              onclick={() => (planOpen = true)}
            >
              <PlusCircle size={iconSizes.sm} />{m.pos_plan_open()}
            </Button>
          </div>
        {/if}
      </section>

      <!-- Append-only ledger: a correction is an opposing row, never an edit -->
      <section class="blk">
        <h4 class="t-label">{m.pos_acct_ledger()}</h4>
        {#if d.ledger.length === 0}
          <p class="t-caption dim">{m.pos_acct_ledger_empty()}</p>
        {:else}
          <ul class="rows">
            {#each d.ledger as e (e.id)}
              <li class="row">
                <span class="t-caption when">{fmtDateTime(e.createdAt)}</span>
                <span class="grow">{(LEDGER_KIND[e.kind] ?? (() => e.kind))()}</span>
                {#if e.note}<span class="t-caption dim">{e.note}</span>{/if}
                <span class="amount" class:neg={Number(e.amount) < 0}>
                  {formatMoney(e.amount, e.currency)}
                </span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      {#if err}<p class="t-caption bad">{err}</p>{/if}
    </div>
  {/if}
</Sheet>

<style>
  .center {
    display: flex;
    justify-content: center;
    padding: var(--space-8);
  }
  .drawer {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .blk {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .head-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .balance {
    font-variant-numeric: tabular-nums;
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .wrap {
    flex-wrap: wrap;
  }
  .grow {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  .draw-form {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    background: var(--color-surface-2);
  }
  .when {
    flex-shrink: 0;
  }
  .amount {
    font-variant-numeric: tabular-nums;
    color: var(--color-success-fg);
  }
  .amount.neg {
    color: var(--color-text-secondary);
  }
  .dim {
    color: var(--color-text-tertiary);
  }
  .bad {
    color: var(--color-danger-fg);
  }
</style>
