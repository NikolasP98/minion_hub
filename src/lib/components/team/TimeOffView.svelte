<script lang="ts">
  // Time off: calendar (month / week / agenda) over leave + holidays, the
  // requests table and balances. Holidays / weekly off / leave types /
  // allocations are configured on the Settings tab.
  import { MediaQuery } from 'svelte/reactivity';
  import { MoreVertical, Check, X, Ban } from 'lucide-svelte';
  import { invalidate } from '$app/navigation';
  import {
    Button,
    Badge,
    Card,
    Input,
    Modal,
    Dropdown,
    Select,
    Toggle,
    iconSizes,
  } from '$lib/components/ui';
  import type { DropdownItem, SelectOption } from '$lib/components/ui';
  import { FormField, Sheet } from '$lib/components/ui/foundations';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import * as m from '$lib/paraglide/messages';
  import { jsonMutation } from '$lib/api/json-mutation';
  import { fetchJson } from '$lib/api/fetch-json';
  import { hrErrorMessage } from './hr-error';
  import { leaveBalances } from './balances';
  import TimeOffCalendar, { type CalendarView } from './TimeOffCalendar.svelte';
  import {
    JSON_HEADERS,
    todayKey,
    type LeaveStatus,
    type TeamAllocation,
    type TeamEmployee,
    type TeamHoliday,
    type TeamHrSettings,
    type TeamLeaveRequest,
    type TeamLeaveType,
    type TeamMember,
  } from './types';

  let {
    employees,
    leaveTypes,
    allocations,
    requests,
    holidays,
    hrSettings,
    members,
    canEdit,
    canDecide,
    myEmployeeId,
    requestFor = null,
  }: {
    employees: TeamEmployee[];
    leaveTypes: TeamLeaveType[];
    allocations: TeamAllocation[];
    requests: TeamLeaveRequest[];
    holidays: TeamHoliday[];
    hrSettings: TeamHrSettings;
    members: TeamMember[];
    canEdit: boolean;
    /** users.manage or scheduling:edit — may approve / reject. */
    canDecide: boolean;
    /** The viewer's own employee row — nobody decides their own request (hrms prevent_self_leave_approval). */
    myEmployeeId: string | null;
    /** Open the request dialog for this employee on mount (People → "Request"). */
    requestFor?: string | null;
  } = $props();

  let error = $state<string | null>(null);
  let busy = $state(false);
  // Phones open on the agenda (a 7-column month grid is unreadable at 390px).
  const phone = new MediaQuery('(max-width: 767px)');
  // svelte-ignore state_referenced_locally
  let calView = $state<CalendarView>(phone.current ? 'agenda' : 'month');

  const active = $derived(employees.filter((e) => e.status === 'active'));
  const empName = $derived(new Map(employees.map((e) => [e.id, e.name])));
  const typeName = $derived(new Map(leaveTypes.map((t) => [t.id, t.name])));
  const memberName = $derived(
    new Map(members.map((mb) => [mb.id, mb.displayName || mb.email || mb.id])),
  );
  const STATUS_LABEL: Record<LeaveStatus, () => string> = {
    pending: m.team_leave_pending,
    approved: m.team_leave_approved,
    rejected: m.team_leave_rejected,
    cancelled: m.team_leave_cancelled,
  };
  const STATUS_TONE = {
    pending: 'warning',
    approved: 'success',
    rejected: 'error',
    cancelled: 'info',
  } as const;

  // ── Requests table ───────────────────────────────────────────────────────────
  type Row = TeamLeaveRequest & { employee: string; type: string; decider: string };
  const rows = $derived<Row[]>(
    requests.map((r) => ({
      ...r,
      employee: empName.get(r.employeeId) ?? '—',
      type: typeName.get(r.leaveTypeId) ?? '—',
      decider: r.decidedBy ? (memberName.get(r.decidedBy) ?? '—') : '',
    })),
  );
  const columns: DataColumn<Row>[] = [
    { key: 'employee', label: m.team_employee(), width: 180 },
    { key: 'type', label: m.team_leave_type(), width: 130 },
    { key: 'dates', label: m.team_from(), custom: true, accessor: (r) => r.fromDate, width: 210 },
    { key: 'days', label: m.team_days(), align: 'right', width: 70 },
    {
      key: 'status',
      label: m.team_col_status(),
      custom: true,
      width: 120,
      filter: {
        options: () =>
          (Object.keys(STATUS_LABEL) as LeaveStatus[]).map((s) => ({
            value: s,
            label: STATUS_LABEL[s](),
          })),
      },
    },
    { key: 'decider', label: m.team_decided_by(), width: 130 },
    { key: 'actions', label: m.team_col_actions(), custom: true, sortable: false, width: 60 },
  ];

  const isMine = (r: TeamLeaveRequest) => myEmployeeId !== null && r.employeeId === myEmployeeId;
  function rowMenu(r: TeamLeaveRequest): DropdownItem[] {
    const items: DropdownItem[] = [];
    // The API answers 409 self_approval as well; hiding the verbs is the UI half.
    if (r.status === 'pending' && canDecide && !isMine(r)) {
      items.push(
        { value: 'approved', label: m.team_approve(), icon: Check },
        { value: 'rejected', label: m.team_reject(), icon: X },
      );
    }
    if ((r.status === 'pending' || r.status === 'approved') && canEdit) {
      if (items.length) items.push({ value: 'd', label: '', divider: true });
      items.push({ value: 'cancelled', label: m.common_cancel(), icon: Ban, danger: true });
    }
    return items;
  }
  async function decide(id: string, status: string) {
    error = null;
    busy = true;
    try {
      await jsonMutation({
        input: `/api/scheduling/hr/leave-requests/${id}`,
        init: { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ status }) },
        onSuccess: () => invalidate('team:data'),
      });
    } catch (e) {
      error = hrErrorMessage(e);
    } finally {
      busy = false;
    }
  }

  // ── Detail sheet (calendar click / row click) ────────────────────────────────
  let detailId = $state<string | null>(null);
  const detail = $derived(
    detailId?.startsWith('leave:')
      ? { kind: 'leave' as const, row: requests.find((r) => r.id === detailId!.slice(6)) }
      : detailId?.startsWith('holiday:')
        ? { kind: 'holiday' as const, row: holidays.find((h) => h.id === detailId!.slice(8)) }
        : null,
  );

  // ── New request dialog (hrms leave_application: live balance) ────────────────
  let reqOpen = $state(false);
  let reqEmployee = $state('');
  let reqType = $state('');
  let reqFrom = $state(todayKey());
  let reqTo = $state(todayKey());
  let reqHalf = $state(false);
  let reqReason = $state('');
  let balance = $state<{
    allocated: number;
    approved: number;
    pending: number;
    available: number;
  } | null>(null);
  const employeeOptions = $derived<SelectOption[]>(
    active.map((e) => ({ value: e.id, label: e.name })),
  );
  const typeOptions = $derived<SelectOption[]>(
    leaveTypes.map((t) => ({ value: t.id, label: t.name })),
  );

  function openRequest(employeeId?: string) {
    reqEmployee = employeeId || reqEmployee || active[0]?.id || '';
    reqType = reqType || leaveTypes[0]?.id || '';
    reqOpen = true;
  }
  $effect(() => {
    if (requestFor && canEdit) openRequest(requestFor);
  });
  $effect(() => {
    if (!reqOpen || !reqEmployee || !reqType || !reqFrom) {
      balance = null;
      return;
    }
    const q = new URLSearchParams({
      balance: '1',
      employeeId: reqEmployee,
      leaveTypeId: reqType,
      on: reqFrom,
    });
    fetchJson<{ balance: typeof balance }>(`/api/scheduling/hr/leave-requests?${q}`)
      .then((r) => (balance = r.balance))
      .catch(() => (balance = null));
  });
  async function submitRequest() {
    error = null;
    busy = true;
    try {
      await jsonMutation({
        input: '/api/scheduling/hr/leave-requests',
        init: {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            employeeId: reqEmployee,
            leaveTypeId: reqType,
            fromDate: reqFrom,
            toDate: reqTo,
            halfDay: reqHalf,
            reason: reqReason.trim() || null,
          }),
        },
        onSuccess: () => invalidate('team:data'),
      });
      reqOpen = false;
      reqReason = '';
      reqHalf = false;
    } catch (e) {
      error = hrErrorMessage(e);
    } finally {
      busy = false;
    }
  }

  // ── Balances (hrms leave balance report) ─────────────────────────────────────
  const balances = $derived(leaveBalances(active, leaveTypes, allocations, requests));
  const pct = (b: { available: number; allocated: number }) =>
    b.allocated ? Math.max(0, Math.min(100, (b.available / b.allocated) * 100)) : 0;
</script>

{#if error}
  <p class="hr-alert" role="alert">{error}</p>
{/if}

<Card padding="md">
  <div class="cal-head">
    <span class="t-label">{m.team_whos_off()}</span>
    <Button size="sm" onclick={() => openRequest()} disabled={!canEdit || active.length === 0}>
      + {m.team_request()}
    </Button>
  </div>
  <TimeOffCalendar
    {requests}
    {holidays}
    weeklyOff={hrSettings.weeklyOff}
    employeeName={(id) => empName.get(id) ?? '—'}
    typeName={(id) => typeName.get(id) ?? '—'}
    bind:view={calView}
    onEventClick={(id) => (detailId = id)}
  />
</Card>

<div class="cols">
  <DataTable
    class="requests"
    {columns}
    data={rows}
    getRowId={(r) => r.id}
    searchFields={(r) => `${r.employee} ${r.type} ${r.reason ?? ''}`}
    storageKey="team-timeoff"
    canEdit={false}
    onRowClick={(r) => (detailId = `leave:${r.id}`)}
    emptyMessage={m.team_requests_empty()}
  >
    {#snippet cell(r: Row, col: DataColumn<Row>)}
      {#if col.key === 'dates'}
        <span class="tabular-nums">{r.fromDate} → {r.toDate}</span>
        {#if r.halfDay}<Badge size="sm">{m.team_half_day()}</Badge>{/if}
      {:else if col.key === 'status'}
        <Badge variant="semantic" value={STATUS_TONE[r.status]} size="sm" dot>
          {STATUS_LABEL[r.status]()}
        </Badge>
      {:else if col.key === 'actions'}
        {@const items = rowMenu(r)}
        {#if items.length}
          <Dropdown {items} onSelect={(v) => decide(r.id, v)} placement="left">
            {#snippet trigger()}
              <span class="row-menu" aria-label={m.team_col_actions()}>
                <MoreVertical size={iconSizes.md} aria-hidden="true" />
              </span>
            {/snippet}
          </Dropdown>
        {/if}
      {/if}
    {/snippet}
  </DataTable>

  <Card padding="md">
    <div class="t-label mb-2">{m.team_balances()}</div>
    {#if balances.length === 0}
      <p class="t-caption">{m.team_no_allocation()}</p>
    {:else}
      <div class="balances">
        <div class="t-caption">{m.team_employee()}</div>
        <div class="t-caption">{m.team_leave_type()}</div>
        <div class="t-caption num">{m.team_remaining()}</div>
        <div></div>
        {#each balances as b (b.id)}
          <div class="truncate">{b.employee}</div>
          <div class="truncate t-caption">{b.type}</div>
          <div class="num">
            <b>{b.available}</b><span class="t-caption"> / {b.allocated}</span>
            {#if b.pending}<span class="t-caption pending">
                · {b.pending} {m.team_pending_short()}</span
              >{/if}
          </div>
          <div class="bar"><span class="fill" style:width="{pct(b)}%"></span></div>
        {/each}
      </div>
    {/if}
  </Card>
</div>

<Sheet
  open={detail !== null}
  title={detail?.kind === 'holiday' ? m.team_holiday() : m.team_request_title()}
  placement="right"
  size="sm"
  onclose={() => (detailId = null)}
>
  {#if detail?.kind === 'leave' && detail.row}
    {@const r = detail.row}
    {@const items = rowMenu(r)}
    <div class="sheet">
      <dl class="facts">
        <dt>{m.team_employee()}</dt>
        <dd>{empName.get(r.employeeId) ?? '—'}</dd>
        <dt>{m.team_leave_type()}</dt>
        <dd>{typeName.get(r.leaveTypeId) ?? '—'}</dd>
        <dt>{m.team_from()}</dt>
        <dd class="tabular-nums">{r.fromDate} → {r.toDate}</dd>
        <dt>{m.team_days()}</dt>
        <dd>
          {r.days}{#if r.halfDay}
            · {m.team_half_day()}{/if}
        </dd>
        <dt>{m.team_col_status()}</dt>
        <dd>
          <Badge variant="semantic" value={STATUS_TONE[r.status]} size="sm" dot>
            {STATUS_LABEL[r.status]()}
          </Badge>
        </dd>
        {#if r.reason}
          <dt>{m.team_reason()}</dt>
          <dd>{r.reason}</dd>
        {/if}
        {#if r.decidedBy}
          <dt>{m.team_decided_by()}</dt>
          <dd>{memberName.get(r.decidedBy) ?? '—'}</dd>
        {/if}
      </dl>
      {#if r.status === 'pending' && canDecide && isMine(r)}
        <p class="t-caption">{m.team_err_self_approval()}</p>
      {/if}
      {#if items.length}
        <div class="hr-inline">
          {#each items.filter((i) => !i.divider) as it (it.value)}
            <Button
              size="sm"
              variant={it.danger ? 'danger' : it.value === 'approved' ? 'primary' : 'secondary'}
              disabled={busy}
              onclick={() => decide(r.id, it.value).then(() => (detailId = null))}
            >
              {it.label}
            </Button>
          {/each}
        </div>
      {/if}
    </div>
  {:else if detail?.kind === 'holiday' && detail.row}
    <dl class="facts">
      <dt>{m.team_holiday_name()}</dt>
      <dd>{detail.row.name}</dd>
      <dt>{m.team_holiday_date()}</dt>
      <dd class="tabular-nums">{detail.row.date}</dd>
    </dl>
    {#if canEdit}
      <p class="t-caption mt-3">
        <a class="link" href="/team?tab=settings">{m.team_holiday_manage()}</a>
      </p>
    {/if}
  {/if}
</Sheet>

<Modal bind:open={reqOpen} title={m.team_request_title()} size="sm">
  <div class="hr-form">
    <Select label={m.team_employee()} options={employeeOptions} bind:value={reqEmployee} />
    <Select label={m.team_leave_type()} options={typeOptions} bind:value={reqType} />
    <div class="hr-inline">
      <FormField label={m.team_from()} required>
        {#snippet children(control)}
          <input {...control} class="hr-date" type="date" bind:value={reqFrom} />
        {/snippet}
      </FormField>
      <FormField label={m.team_to()} required>
        {#snippet children(control)}
          <input {...control} class="hr-date" type="date" bind:value={reqTo} />
        {/snippet}
      </FormField>
    </div>
    <Toggle bind:checked={reqHalf} label={m.team_half_day()} />
    <FormField label={m.team_reason()}>
      {#snippet children(control)}
        <Input {...control} bind:value={reqReason} />
      {/snippet}
    </FormField>
    {#if balance}
      <p class="t-caption">
        {m.team_balance()}: {m.team_balance_line({
          remaining: String(balance.available),
          allocated: String(balance.allocated),
          pending: String(balance.pending),
        })}
      </p>
    {/if}
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (reqOpen = false)}>{m.common_cancel()}</Button>
    <Button
      onclick={submitRequest}
      disabled={busy || !reqEmployee || !reqType || !reqFrom || !reqTo}
    >
      {m.team_request()}
    </Button>
  {/snippet}
</Modal>

<style>
  .cal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .cols {
    display: grid;
    gap: var(--space-4);
    margin-top: var(--space-4);
    align-items: start;
  }
  .cols > :global(*) {
    min-width: 0;
  }
  @media (min-width: 1024px) {
    .cols {
      grid-template-columns: minmax(0, 1fr) minmax(20rem, 24rem);
    }
  }
  .row-menu {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-secondary);
    border-radius: var(--radius-sm);
    padding: var(--space-1);
  }
  .row-menu:hover {
    background: var(--color-surface-2);
  }
  /* Bar-row contract: label | value | bar LAST, one shared 1fr track. */
  .balances {
    display: grid;
    grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) max-content minmax(3rem, 1fr);
    gap: var(--space-1) var(--space-3);
    align-items: center;
    font-size: var(--font-size-caption);
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .pending {
    color: var(--color-warning-fg);
  }
  .bar {
    height: 0.375rem;
    border-radius: var(--radius-full);
    background: var(--color-surface-3);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    background: var(--color-success-fg);
  }
  .link {
    color: var(--color-accent);
    text-decoration: underline;
  }
  .sheet {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .facts {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-1) var(--space-3);
    margin: 0;
    font-size: var(--font-size-caption);
  }
  .facts dt {
    color: var(--color-text-secondary);
  }
  .facts dd {
    margin: 0;
    min-width: 0;
  }
</style>
