<script lang="ts">
  // Time off + holidays in one view (owner: "fold time off and holidays into a single view").
  // Top: who's-off month grid. Below, ≥1024px: requests + balances (left) · holidays (right).
  import { ChevronLeft, ChevronRight, MoreVertical, Check, X, Ban, Trash2 } from 'lucide-svelte';
  import { invalidate } from '$app/navigation';
  import { Checkbox } from '@minion-stack/ui';
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
  import { FormField } from '$lib/components/ui/foundations';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import * as m from '$lib/paraglide/messages';
  import { languageTag } from '$lib/paraglide/runtime';
  import { jsonMutation } from '$lib/api/json-mutation';
  import { fetchJson } from '$lib/api/fetch-json';
  import { hrErrorMessage } from './hr-error';
  import {
    JSON_HEADERS,
    todayKey,
    type LeaveStatus,
    type TeamAllocation,
    type TeamEmployee,
    type TeamHoliday,
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
    members,
    canEdit,
    canDecide,
    myEmployeeId,
  }: {
    employees: TeamEmployee[];
    leaveTypes: TeamLeaveType[];
    allocations: TeamAllocation[];
    requests: TeamLeaveRequest[];
    holidays: TeamHoliday[];
    members: TeamMember[];
    canEdit: boolean;
    /** users.manage or scheduling:edit — may approve / reject. */
    canDecide: boolean;
    /** The viewer's own employee row — nobody decides their own request (hrms prevent_self_leave_approval). */
    myEmployeeId: string | null;
  } = $props();

  let error = $state<string | null>(null);
  let busy = $state(false);

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
    { key: 'actions', label: m.team_col_actions(), custom: true, sortable: false, width: 150 },
  ];

  const isMine = (r: Row) => myEmployeeId !== null && r.employeeId === myEmployeeId;
  function rowMenu(r: Row): DropdownItem[] {
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
    try {
      await jsonMutation({
        input: `/api/scheduling/hr/leave-requests/${id}`,
        init: { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ status }) },
        onSuccess: () => invalidate('team:data'),
      });
    } catch (e) {
      error = hrErrorMessage(e);
    }
  }

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

  function openRequest() {
    reqEmployee = reqEmployee || active[0]?.id || '';
    reqType = reqType || leaveTypes[0]?.id || '';
    reqOpen = true;
  }
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

  // ── Month grid: who is off (approved) + holidays ─────────────────────────────
  let month = $state(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const monthLabel = $derived(
    new Intl.DateTimeFormat(languageTag(), { month: 'long', year: 'numeric' }).format(month),
  );
  // Monday-first weekday labels in the user's locale (JS getDay: 0 = Sunday).
  const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0].map((dow) => ({
    dow,
    label: new Intl.DateTimeFormat(languageTag(), { weekday: 'short' }).format(
      new Date(2024, 0, 7 + dow),
    ),
  }));
  const holidayByDate = $derived(new Map(holidays.map((h) => [h.date, h])));
  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const cells = $derived.by(() => {
    const first = new Date(month);
    const lead = (first.getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const approved = requests.filter((r) => r.status === 'approved');
    const out: { key: string | null; day: number; holiday: string | null; off: string[] }[] = [];
    for (let i = 0; i < lead; i++) out.push({ key: null, day: 0, holiday: null, off: [] });
    for (let d = 1; d <= daysInMonth; d++) {
      const k = key(new Date(month.getFullYear(), month.getMonth(), d));
      out.push({
        key: k,
        day: d,
        holiday: holidayByDate.get(k)?.name ?? null,
        off: approved
          .filter((r) => r.fromDate <= k && k <= r.toDate)
          .map((r) => empName.get(r.employeeId) ?? '—'),
      });
    }
    return out;
  });
  const today = todayKey();
  const shiftMonth = (n: number) =>
    (month = new Date(month.getFullYear(), month.getMonth() + n, 1));

  // ── Balances (allocation covering today, per employee × type) ────────────────
  const balances = $derived.by(() =>
    active.flatMap((e) =>
      leaveTypes.flatMap((t) => {
        const allocs = allocations.filter(
          (a) =>
            a.employeeId === e.id &&
            a.leaveTypeId === t.id &&
            a.periodStart <= today &&
            today <= a.periodEnd,
        );
        if (!allocs.length) return [];
        const start = allocs.map((a) => a.periodStart).sort()[0];
        const end = allocs
          .map((a) => a.periodEnd)
          .sort()
          .at(-1)!;
        const inPeriod = requests.filter(
          (r) =>
            r.employeeId === e.id &&
            r.leaveTypeId === t.id &&
            r.fromDate <= end &&
            r.toDate >= start,
        );
        const sum = (s: LeaveStatus) =>
          inPeriod.filter((r) => r.status === s).reduce((n, r) => n + r.days, 0);
        const allocated = allocs.reduce((n, a) => n + a.days, 0);
        const approved = sum('approved');
        const pending = sum('pending');
        return [
          {
            id: `${e.id}:${t.id}`,
            employee: e.name,
            type: t.name,
            allocated,
            approved,
            pending,
            available: allocated - approved - pending,
          },
        ];
      }),
    ),
  );

  let allocOpen = $state(false);
  let allocEmployee = $state('');
  let allocType = $state('');
  let allocStart = $state(`${new Date().getFullYear()}-01-01`);
  let allocEnd = $state(`${new Date().getFullYear()}-12-31`);
  let allocDays = $state('');
  function openAllocation() {
    allocEmployee = allocEmployee || active[0]?.id || '';
    allocType = allocType || leaveTypes[0]?.id || '';
    allocOpen = true;
  }
  async function submitAllocation() {
    error = null;
    busy = true;
    try {
      await jsonMutation({
        input: '/api/scheduling/hr/leave-allocations',
        init: {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({
            employeeId: allocEmployee,
            leaveTypeId: allocType,
            periodStart: allocStart,
            periodEnd: allocEnd,
            days: Number(allocDays),
          }),
        },
        onSuccess: () => invalidate('team:data'),
      });
      allocOpen = false;
      allocDays = '';
    } catch (e) {
      error = hrErrorMessage(e);
    } finally {
      busy = false;
    }
  }

  // ── Holidays (list, add, weekly-off chooser, delete) ─────────────────────────
  const year = new Date().getFullYear();
  // Seed the chooser from the weekdays already materialised as weekly offs.
  const materialised = $derived(
    new Set(
      holidays.filter((h) => h.weeklyOff).map((h) => new Date(`${h.date}T00:00:00`).getDay()),
    ),
  );
  // svelte-ignore state_referenced_locally
  let weeklyOff = $state<Record<number, boolean>>(
    Object.fromEntries(WEEKDAYS.map((w) => [w.dow, materialised.has(w.dow)])),
  );
  let newDate = $state(todayKey());
  let newName = $state('');

  const holidayColumns: DataColumn<TeamHoliday>[] = [
    { key: 'date', label: m.team_holiday_date(), width: 110 },
    { key: 'name', label: m.team_holiday_name() },
    { key: 'weeklyOff', label: m.team_col_status(), custom: true, width: 100 },
    { key: 'actions', label: m.team_col_actions(), custom: true, sortable: false, width: 50 },
  ];

  async function postHoliday(body: Record<string, unknown>) {
    error = null;
    busy = true;
    try {
      await jsonMutation({
        input: '/api/scheduling/hr/holidays',
        init: { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
        onSuccess: () => invalidate('team:data'),
      });
      return true;
    } catch (e) {
      error = hrErrorMessage(e);
      return false;
    } finally {
      busy = false;
    }
  }
  async function addHoliday() {
    if (!newDate || !newName.trim()) return;
    if (await postHoliday({ date: newDate, name: newName.trim() })) newName = '';
  }
  // Reconciles both ways: checked weekdays are materialised, unchecked ones are removed.
  async function applyWeeklyOff() {
    const days = WEEKDAYS.filter((w) => weeklyOff[w.dow]).map((w) => w.dow);
    await postHoliday({ weeklyOff: days, from: `${year}-01-01`, to: `${year}-12-31` });
  }
  async function removeHoliday(id: string) {
    error = null;
    try {
      await jsonMutation({
        input: `/api/scheduling/hr/holidays/${id}`,
        // PATCH so the removal rides on scheduling:edit (DELETE would need scheduling:delete).
        init: { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ deleted: true }) },
        onSuccess: () => invalidate('team:data'),
      });
    } catch (e) {
      error = hrErrorMessage(e);
    }
  }
</script>

{#if error}
  <p class="hr-alert" role="alert">{error}</p>
{/if}

<Card padding="md">
  <div class="month-head">
    <Button variant="ghost" size="xs" shape="icon" aria-label="‹" onclick={() => shiftMonth(-1)}>
      <ChevronLeft size={iconSizes.sm} aria-hidden="true" />
    </Button>
    <span class="t-label">{m.team_whos_off()} · {monthLabel}</span>
    <Button variant="ghost" size="xs" shape="icon" aria-label="›" onclick={() => shiftMonth(1)}>
      <ChevronRight size={iconSizes.sm} aria-hidden="true" />
    </Button>
  </div>
  <div class="grid" role="grid" aria-label={monthLabel}>
    {#each WEEKDAYS as w (w.dow)}
      <div class="t-caption dow">{w.label}</div>
    {/each}
    {#each cells as c, i (c.key ?? `blank-${i}`)}
      <div
        class="cell"
        class:blank={!c.key}
        class:today={c.key === today}
        class:holiday={c.holiday}
      >
        {#if c.key}
          <span class="day">{c.day}</span>
          {#if c.holiday}<span class="t-caption truncate" title={c.holiday}>{c.holiday}</span>{/if}
          {#each c.off as name (name)}
            <span class="off truncate" title={name}>{name}</span>
          {/each}
        {/if}
      </div>
    {/each}
  </div>
</Card>

<div class="cols">
  <div class="col">
    <DataTable
      class="requests"
      {columns}
      data={rows}
      getRowId={(r) => r.id}
      searchFields={(r) => `${r.employee} ${r.type} ${r.reason ?? ''}`}
      storageKey="team-timeoff"
      canEdit={false}
      addLabel={m.team_request()}
      onAdd={openRequest}
      addDisabled={!canEdit || active.length === 0}
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
          {#if r.status === 'pending' && canDecide && isMine(r)}
            <span class="t-caption self-note">{m.team_err_self_approval()}</span>
          {/if}
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
      <div class="flex items-center justify-between gap-2 mb-2">
        <span class="t-label">{m.team_balances()}</span>
        <Button
          variant="outline"
          size="sm"
          onclick={openAllocation}
          disabled={!canEdit || active.length === 0}
        >
          + {m.team_allocation()}
        </Button>
      </div>
      {#if balances.length === 0}
        <p class="t-caption">—</p>
      {:else}
        <div class="balances">
          <div class="t-caption">{m.team_employee()}</div>
          <div class="t-caption">{m.team_leave_type()}</div>
          <div class="t-caption num">{m.team_allocated()}</div>
          <div class="t-caption num">{m.team_used()}</div>
          <div class="t-caption num">{m.team_pending_short()}</div>
          <div class="t-caption num">{m.team_remaining()}</div>
          {#each balances as b (b.id)}
            <div class="truncate">{b.employee}</div>
            <div class="truncate">{b.type}</div>
            <div class="num">{b.allocated}</div>
            <div class="num">{b.approved}</div>
            <div class="num">{b.pending}</div>
            <div class="num font-medium">{b.available}</div>
          {/each}
        </div>
      {/if}
    </Card>
  </div>

  <section class="col" aria-label={m.team_tab_holidays()}>
    <Card padding="md">
      <div class="t-label mb-2">{m.team_tab_holidays()}</div>
      <div class="hr-inline">
        <FormField label={m.team_holiday_date()} required>
          {#snippet children(control)}
            <input {...control} class="hr-date" type="date" bind:value={newDate} />
          {/snippet}
        </FormField>
        <FormField label={m.team_holiday_name()} required>
          {#snippet children(control)}
            <Input {...control} bind:value={newName} />
          {/snippet}
        </FormField>
        <Button onclick={addHoliday} disabled={busy || !canEdit || !newDate || !newName.trim()}>
          {m.common_add()}
        </Button>
      </div>
    </Card>

    <Card padding="md">
      <div class="t-label mb-1">{m.team_weekly_off()}</div>
      <p class="t-caption mb-2">{m.team_weekly_off_hint({ year: String(year) })}</p>
      <div class="hr-inline">
        {#each WEEKDAYS as w (w.dow)}
          <Checkbox bind:checked={weeklyOff[w.dow]} label={w.label} />
        {/each}
        <Button variant="outline" onclick={applyWeeklyOff} disabled={busy || !canEdit}>
          {m.team_weekly_off_apply()}
        </Button>
      </div>
    </Card>

    <DataTable
      columns={holidayColumns}
      data={holidays}
      getRowId={(h) => h.id}
      storageKey="team-holidays"
      canEdit={false}
      initialSort={{ key: 'date', dir: 'asc' }}
      emptyMessage={m.team_holidays_empty()}
    >
      {#snippet cell(h: TeamHoliday, col: DataColumn<TeamHoliday>)}
        {#if col.key === 'weeklyOff'}
          {#if h.weeklyOff}
            <Badge size="sm">{m.team_weekly_off_badge()}</Badge>
          {:else}
            <Badge variant="semantic" value="info" size="sm">{m.team_holiday()}</Badge>
          {/if}
        {:else if col.key === 'actions'}
          {#if canEdit}
            <Button
              variant="ghost"
              size="xs"
              shape="icon"
              aria-label={m.common_delete()}
              onclick={() => removeHoliday(h.id)}
            >
              <Trash2 size={iconSizes.sm} aria-hidden="true" />
            </Button>
          {/if}
        {/if}
      {/snippet}
    </DataTable>
  </section>
</div>

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

<Modal bind:open={allocOpen} title={m.team_allocation()} size="sm">
  <div class="hr-form">
    <Select label={m.team_employee()} options={employeeOptions} bind:value={allocEmployee} />
    <Select label={m.team_leave_type()} options={typeOptions} bind:value={allocType} />
    <div class="hr-inline">
      <FormField label={m.team_period_start()} required>
        {#snippet children(control)}
          <input {...control} class="hr-date" type="date" bind:value={allocStart} />
        {/snippet}
      </FormField>
      <FormField label={m.team_period_end()} required>
        {#snippet children(control)}
          <input {...control} class="hr-date" type="date" bind:value={allocEnd} />
        {/snippet}
      </FormField>
    </div>
    <FormField label={m.team_days()} required>
      {#snippet children(control)}
        <Input {...control} type="number" bind:value={allocDays} />
      {/snippet}
    </FormField>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (allocOpen = false)}>{m.common_cancel()}</Button>
    <Button
      onclick={submitAllocation}
      disabled={busy || !allocEmployee || !allocType || !(Number(allocDays) >= 0) || !allocDays}
    >
      {m.common_save()}
    </Button>
  {/snippet}
</Modal>

<style>
  .cols {
    display: grid;
    gap: var(--space-4);
    margin-top: var(--space-4);
    align-items: start;
  }
  .col {
    min-width: 0;
    display: grid;
    gap: var(--space-4);
  }
  @media (min-width: 1024px) {
    .cols {
      grid-template-columns: minmax(0, 1fr) minmax(22.5rem, 25rem);
    }
  }
  .self-note {
    color: var(--color-text-secondary);
    margin-right: var(--space-2);
    white-space: normal;
    line-height: 1.2;
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
  .month-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: var(--space-0-5);
  }
  .dow {
    text-align: center;
  }
  .cell {
    min-height: 3.5rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    padding: var(--space-1);
    border-radius: var(--radius-sm);
    background: var(--color-surface-2);
    border: 1px solid transparent;
    min-width: 0;
  }
  .cell.blank {
    background: transparent;
  }
  .cell.today {
    border-color: var(--color-accent);
  }
  .cell.holiday {
    background: var(--color-info-surface);
    border-color: var(--color-info-border);
  }
  .day {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }
  .off {
    font-size: var(--font-size-caption);
    padding: 0 var(--space-1);
    border-radius: var(--radius-xs);
    background: var(--color-warning-surface);
    color: var(--color-warning-fg);
  }
  .balances {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1.5fr) repeat(4, max-content);
    gap: var(--space-1) var(--space-3);
    align-items: center;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>
