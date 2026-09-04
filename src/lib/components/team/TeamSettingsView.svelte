<script lang="ts">
  // /team → Settings: the module's own configuration (hrms Holiday List +
  // Leave Type + Leave Allocation). Holidays are imported per country and
  // toggled / moved; weekly off is ONE recurring rule.
  import { MoreVertical, CalendarDays, Trash2, RotateCcw, CalendarClock } from 'lucide-svelte';
  import { invalidate } from '$app/navigation';
  import { Checkbox } from '@minion-stack/ui';
  import {
    Button,
    Badge,
    Card,
    EmptyState,
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
  import { hrErrorMessage } from './hr-error';
  import {
    JSON_HEADERS,
    todayKey,
    type TeamAllocation,
    type TeamEmployee,
    type TeamHoliday,
    type TeamHrSettings,
    type TeamLeaveType,
  } from './types';

  let {
    employees,
    holidays,
    hrSettings,
    leaveTypes,
    allocations,
    canEdit,
  }: {
    employees: TeamEmployee[];
    holidays: TeamHoliday[];
    hrSettings: TeamHrSettings;
    leaveTypes: TeamLeaveType[];
    allocations: TeamAllocation[];
    canEdit: boolean;
  } = $props();

  let error = $state<string | null>(null);
  let busy = $state(false);
  let notice = $state<string | null>(null);

  async function mutate(input: string, method: string, body: unknown) {
    error = null;
    busy = true;
    try {
      await jsonMutation({
        input,
        init: { method, headers: JSON_HEADERS, body: JSON.stringify(body) },
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

  // ── Holidays: country import + toggle / move / delete ────────────────────────
  // ponytail: a short curated list; Nager.Date `AvailableCountries` can feed a full Select (proposal #15).
  const COUNTRIES = ['PE', 'AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'ES', 'MX', 'US'];
  const countryOptions = $derived<SelectOption[]>(
    COUNTRIES.map((c) => ({
      value: c,
      label: new Intl.DisplayNames([languageTag()], { type: 'region' }).of(c) ?? c,
    })),
  );
  const thisYear = new Date().getFullYear();
  const yearOptions: SelectOption[] = [thisYear - 1, thisYear, thisYear + 1].map((y) => ({
    value: String(y),
    label: String(y),
  }));
  // svelte-ignore state_referenced_locally
  let country = $state(hrSettings.country ?? 'PE');
  let year = $state(String(thisYear));

  async function importHolidays() {
    notice = null;
    const ok = await jsonMutation({
      input: '/api/scheduling/hr/holidays',
      init: {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ import: { country, year: Number(year) } }),
      },
      onSuccess: () => invalidate('team:data'),
    })
      .then((r) => r as { imported: number; total: number })
      .catch((e) => {
        error = hrErrorMessage(e);
        return null;
      });
    if (ok)
      notice = m.team_holiday_import_done({
        imported: String(ok.imported),
        total: String(ok.total),
      });
  }

  const holidayColumns: DataColumn<TeamHoliday>[] = [
    { key: 'enabled', label: m.team_holiday_enabled(), custom: true, sortable: false, width: 70 },
    { key: 'date', label: m.team_holiday_date(), custom: true, width: 130 },
    { key: 'name', label: m.team_holiday_name(), width: 260 },
    {
      key: 'source',
      label: m.team_holiday_source(),
      custom: true,
      width: 110,
      filter: {
        options: () => [
          { value: 'country', label: m.team_holiday_source_country() },
          { value: 'manual', label: m.team_holiday_source_manual() },
        ],
      },
    },
    { key: 'actions', label: m.team_col_actions(), custom: true, sortable: false, width: 60 },
  ];
  const originalDate = (h: TeamHoliday) => h.sourceKey?.split(':')[1] ?? null;
  const moved = (h: TeamHoliday) => {
    const o = originalDate(h);
    return o !== null && o !== h.date;
  };
  function holidayMenu(h: TeamHoliday): DropdownItem[] {
    const items: DropdownItem[] = [
      { value: 'move', label: m.team_holiday_move(), icon: CalendarClock },
    ];
    if (moved(h)) items.push({ value: 'reset', label: m.team_holiday_reset(), icon: RotateCcw });
    if (h.source === 'manual')
      items.push(
        { value: 'd', label: '', divider: true },
        { value: 'delete', label: m.common_delete(), icon: Trash2, danger: true },
      );
    return items;
  }
  let moveOpen = $state(false);
  let moveTarget = $state<TeamHoliday | null>(null);
  let moveDate = $state('');
  function onHolidayMenu(h: TeamHoliday, v: string) {
    if (v === 'move') {
      moveTarget = h;
      moveDate = h.date;
      moveOpen = true;
    } else if (v === 'reset') {
      void mutate(`/api/scheduling/hr/holidays/${h.id}`, 'PATCH', { date: originalDate(h) });
    } else if (v === 'delete') {
      // PATCH so the removal rides on scheduling:edit (DELETE would need scheduling:delete).
      void mutate(`/api/scheduling/hr/holidays/${h.id}`, 'PATCH', { deleted: true });
    }
  }
  async function confirmMove() {
    if (!moveTarget || !moveDate) return;
    if (await mutate(`/api/scheduling/hr/holidays/${moveTarget.id}`, 'PATCH', { date: moveDate }))
      moveOpen = false;
  }
  const toggleHoliday = (h: TeamHoliday, enabled: boolean) =>
    mutate(`/api/scheduling/hr/holidays/${h.id}`, 'PATCH', { enabled });

  let addOpen = $state(false);
  let newDate = $state(todayKey());
  let newName = $state('');
  async function addHoliday() {
    if (!newDate || !newName.trim()) return;
    if (
      await mutate('/api/scheduling/hr/holidays', 'POST', { date: newDate, name: newName.trim() })
    ) {
      addOpen = false;
      newName = '';
    }
  }

  // ── Weekly off: one recurring rule ───────────────────────────────────────────
  const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0].map((dow) => ({
    dow,
    label: new Intl.DateTimeFormat(languageTag(), { weekday: 'short' }).format(
      new Date(2024, 0, 7 + dow),
    ),
  }));
  // svelte-ignore state_referenced_locally
  let weeklyOff = $state<Record<number, boolean>>(
    Object.fromEntries(WEEKDAYS.map((w) => [w.dow, hrSettings.weeklyOff.includes(w.dow)])),
  );
  const chosen = $derived(WEEKDAYS.filter((w) => weeklyOff[w.dow]));
  const dirty = $derived(
    chosen.map((w) => w.dow).join(',') !== [...hrSettings.weeklyOff].sort().join(','),
  );
  const saveWeeklyOff = () =>
    mutate('/api/scheduling/hr/settings', 'PATCH', { weeklyOff: chosen.map((w) => w.dow) });

  // ── Leave types ──────────────────────────────────────────────────────────────
  // TODO(handoff): add-only; rename / deactivate / max-days edits need a modal over
  // the same POST (upsert by code) — proposal 2026-09-03-hub-team-hr-tabs-followups #14.
  let typeOpen = $state(false);
  let typeName = $state('');
  let typeCode = $state('');
  let typePaid = $state(true);
  let typeNegative = $state(false);
  let typeHoliday = $state(false);
  let typeMax = $state('');
  async function addLeaveType() {
    const code =
      typeCode
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_') ||
      typeName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_');
    if (!typeName.trim() || !code) return;
    const ok = await mutate('/api/scheduling/hr/leave-types', 'POST', {
      code,
      name: typeName.trim(),
      paid: typePaid,
      allowNegative: typeNegative,
      includeHoliday: typeHoliday,
      maxDaysPerRequest: typeMax ? Number(typeMax) : null,
    });
    if (ok) {
      typeOpen = false;
      typeName = typeCode = typeMax = '';
    }
  }

  // ── Allocations (hrms Leave Allocation) ──────────────────────────────────────
  const active = $derived(employees.filter((e) => e.status === 'active'));
  const empName = $derived(new Map(employees.map((e) => [e.id, e.name])));
  const tName = $derived(new Map(leaveTypes.map((t) => [t.id, t.name])));
  type AllocRow = TeamAllocation & { employee: string; type: string };
  const allocRows = $derived<AllocRow[]>(
    allocations.map((a) => ({
      ...a,
      employee: empName.get(a.employeeId) ?? '—',
      type: tName.get(a.leaveTypeId) ?? '—',
    })),
  );
  const allocColumns: DataColumn<AllocRow>[] = [
    { key: 'employee', label: m.team_employee(), width: 180 },
    { key: 'type', label: m.team_leave_type(), width: 140 },
    {
      key: 'period',
      label: m.team_period_start(),
      custom: true,
      accessor: (r) => r.periodStart,
      width: 210,
    },
    { key: 'days', label: m.team_days(), align: 'right', width: 70 },
    { key: 'actions', label: m.team_col_actions(), custom: true, sortable: false, width: 50 },
  ];
  const employeeOptions = $derived<SelectOption[]>(
    active.map((e) => ({ value: e.id, label: e.name })),
  );
  const typeOptions = $derived<SelectOption[]>(
    leaveTypes.map((t) => ({ value: t.id, label: t.name })),
  );
  let allocOpen = $state(false);
  let allocEmployee = $state('');
  let allocType = $state('');
  let allocStart = $state(`${thisYear}-01-01`);
  let allocEnd = $state(`${thisYear}-12-31`);
  let allocDays = $state('');
  function openAllocation() {
    allocEmployee = allocEmployee || active[0]?.id || '';
    allocType = allocType || leaveTypes[0]?.id || '';
    allocOpen = true;
  }
  async function submitAllocation() {
    const ok = await mutate('/api/scheduling/hr/leave-allocations', 'POST', {
      employeeId: allocEmployee,
      leaveTypeId: allocType,
      periodStart: allocStart,
      periodEnd: allocEnd,
      days: Number(allocDays),
    });
    if (ok) {
      allocOpen = false;
      allocDays = '';
    }
  }
  const removeAllocation = (id: string) =>
    mutate(`/api/scheduling/hr/leave-allocations/${id}`, 'PATCH', { deleted: true });
</script>

{#if error}
  <p class="hr-alert" role="alert">{error}</p>
{/if}

<div class="settings">
  <section class="block" aria-labelledby="hol-title">
    <Card padding="md">
      <div class="block-head">
        <div>
          <h2 id="hol-title" class="t-label">{m.team_settings_holidays()}</h2>
          <p class="t-caption">{m.team_settings_holidays_hint()}</p>
        </div>
      </div>
      <div class="hr-inline">
        <Select label={m.team_holiday_country()} options={countryOptions} bind:value={country} />
        <Select label={m.team_holiday_year()} options={yearOptions} bind:value={year} />
        <Button variant="secondary" onclick={importHolidays} disabled={busy || !canEdit}>
          {m.team_holiday_import()}
        </Button>
        {#if notice}<span class="t-caption">{notice}</span>{/if}
      </div>
    </Card>
    {#if holidays.length === 0}
      <Card padding="md">
        <EmptyState
          icon={CalendarDays}
          title={m.team_holidays_empty()}
          description={m.team_holidays_empty_import()}
          compact
        />
      </Card>
    {:else}
      <DataTable
        columns={holidayColumns}
        data={holidays}
        getRowId={(h) => h.id}
        storageKey="team-holidays"
        canEdit={false}
        initialSort={{ key: 'date', dir: 'asc' }}
        addLabel={m.team_holiday()}
        onAdd={() => (addOpen = true)}
        addDisabled={!canEdit}
        emptyMessage={m.team_holidays_empty()}
      >
        {#snippet cell(h: TeamHoliday, col: DataColumn<TeamHoliday>)}
          {#if col.key === 'enabled'}
            <Toggle
              size="sm"
              checked={h.enabled}
              disabled={!canEdit || busy}
              ariaLabel={m.team_holiday_enabled()}
              onchange={(v) => toggleHoliday(h, v)}
            />
          {:else if col.key === 'date'}
            <span class="tabular-nums" class:dim={!h.enabled}>{h.date}</span>
            {#if moved(h)}
              <span class="t-caption moved"
                >{m.team_holiday_original({ date: originalDate(h) ?? '' })}</span
              >
            {/if}
          {:else if col.key === 'source'}
            {#if h.source === 'country'}
              <Badge variant="semantic" value="info" size="sm"
                >{m.team_holiday_source_country()}</Badge
              >
            {:else}
              <Badge size="sm">{m.team_holiday_source_manual()}</Badge>
            {/if}
          {:else if col.key === 'actions'}
            {#if canEdit}
              <Dropdown
                items={holidayMenu(h)}
                onSelect={(v) => onHolidayMenu(h, v)}
                placement="left"
              >
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
    {/if}
  </section>

  <section class="block" aria-labelledby="wo-title">
    <Card padding="md">
      <h2 id="wo-title" class="t-label">{m.team_weekly_off()}</h2>
      <p class="t-caption mb-2">{m.team_weekly_off_hint()}</p>
      <div class="hr-inline">
        {#each WEEKDAYS as w (w.dow)}
          <Checkbox bind:checked={weeklyOff[w.dow]} label={w.label} disabled={!canEdit} />
        {/each}
      </div>
      <div class="hr-inline mt-2">
        <span class="t-caption">
          {chosen.length
            ? m.team_weekly_off_summary({ days: chosen.map((w) => w.label).join(', ') })
            : m.team_weekly_off_none()}
        </span>
        <Button size="sm" onclick={saveWeeklyOff} disabled={busy || !canEdit || !dirty}>
          {m.common_save()}
        </Button>
      </div>
    </Card>
  </section>

  <section class="block" aria-labelledby="lt-title">
    <Card padding="md">
      <div class="block-head">
        <h2 id="lt-title" class="t-label">{m.team_settings_leave_types()}</h2>
        <Button size="sm" variant="secondary" onclick={() => (typeOpen = true)} disabled={!canEdit}>
          + {m.team_leave_type()}
        </Button>
      </div>
      <ul class="types">
        {#each leaveTypes as t (t.id)}
          <li>
            <span class="font-medium">{t.name}</span>
            <span class="t-caption t-mono">{t.code}</span>
            <Badge size="sm" variant="semantic" value={t.paid ? 'success' : 'info'}>
              {t.paid ? m.team_leave_paid() : m.team_leave_unpaid()}
            </Badge>
          </li>
        {/each}
      </ul>
    </Card>
  </section>

  <section class="block" aria-labelledby="al-title">
    <DataTable
      columns={allocColumns}
      data={allocRows}
      getRowId={(a) => a.id}
      storageKey="team-allocations"
      canEdit={false}
      addLabel={m.team_allocation()}
      onAdd={openAllocation}
      addDisabled={!canEdit || active.length === 0}
      emptyMessage={m.team_no_allocation()}
    >
      {#snippet toolbar()}
        <h2 id="al-title" class="t-label">{m.team_settings_allocations()}</h2>
      {/snippet}
      {#snippet cell(a: AllocRow, col: DataColumn<AllocRow>)}
        {#if col.key === 'period'}
          <span class="tabular-nums">{a.periodStart} → {a.periodEnd}</span>
        {:else if col.key === 'actions'}
          {#if canEdit}
            <Button
              variant="ghost"
              size="xs"
              shape="icon"
              aria-label={m.common_delete()}
              disabled={busy}
              onclick={() => removeAllocation(a.id)}
            >
              <Trash2 size={iconSizes.sm} aria-hidden="true" />
            </Button>
          {/if}
        {/if}
      {/snippet}
    </DataTable>
  </section>
</div>

<Modal bind:open={addOpen} title={m.team_holiday()} size="sm">
  <div class="hr-form">
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
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (addOpen = false)}>{m.common_cancel()}</Button>
    <Button onclick={addHoliday} disabled={busy || !newDate || !newName.trim()}
      >{m.common_add()}</Button
    >
  {/snippet}
</Modal>

<Modal bind:open={moveOpen} title={m.team_holiday_move()} size="sm">
  <div class="hr-form">
    {#if moveTarget}<p class="t-body">{moveTarget.name}</p>{/if}
    <FormField label={m.team_holiday_date()} required>
      {#snippet children(control)}
        <input {...control} class="hr-date" type="date" bind:value={moveDate} />
      {/snippet}
    </FormField>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (moveOpen = false)}>{m.common_cancel()}</Button>
    <Button onclick={confirmMove} disabled={busy || !moveDate}>{m.common_save()}</Button>
  {/snippet}
</Modal>

<Modal bind:open={typeOpen} title={m.team_leave_type()} size="sm">
  <div class="hr-form">
    <FormField label={m.team_col_name()} required>
      {#snippet children(control)}
        <Input {...control} bind:value={typeName} />
      {/snippet}
    </FormField>
    <FormField label={m.team_leave_type_code()}>
      {#snippet children(control)}
        <Input {...control} bind:value={typeCode} />
      {/snippet}
    </FormField>
    <Toggle bind:checked={typePaid} label={m.team_leave_paid()} />
    <Toggle bind:checked={typeNegative} label={m.team_leave_allow_negative()} />
    <Toggle bind:checked={typeHoliday} label={m.team_leave_include_holiday()} />
    <FormField label={m.team_leave_max_days()}>
      {#snippet children(control)}
        <Input {...control} type="number" bind:value={typeMax} />
      {/snippet}
    </FormField>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (typeOpen = false)}>{m.common_cancel()}</Button>
    <Button onclick={addLeaveType} disabled={busy || !typeName.trim()}>{m.common_add()}</Button>
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
  .settings {
    display: grid;
    gap: var(--space-6);
    max-width: 64rem;
  }
  .block {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
  }
  .block-head {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
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
  .dim {
    color: var(--color-text-disabled);
    text-decoration: line-through;
  }
  .moved {
    display: block;
    color: var(--color-text-secondary);
  }
  .types {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }
  .types li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) max-content max-content;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-1) 0;
    border-bottom: 1px solid var(--color-border);
  }
  .types li:last-child {
    border-bottom: 0;
  }
</style>
