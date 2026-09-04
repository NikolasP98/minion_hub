<script lang="ts">
  import { MoreVertical, Pencil, UserMinus, UserCheck } from 'lucide-svelte';
  import { invalidate } from '$app/navigation';
  import {
    Button,
    Badge,
    Input,
    Modal,
    Dropdown,
    Picker,
    Toggle,
    iconSizes,
  } from '$lib/components/ui';
  import type { DropdownItem, PickerColumn } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import MemberCalendarStrip from '$lib/components/scheduling/MemberCalendarStrip.svelte';
  import * as m from '$lib/paraglide/messages';
  import { jsonMutation } from '$lib/api/json-mutation';
  import { hrErrorMessage } from './hr-error';
  import {
    JSON_HEADERS,
    todayKey,
    type TeamBooking,
    type TeamEmployee,
    type TeamMember,
  } from './types';

  let {
    employees,
    members,
    weekStart,
    bookings,
    eventTypes,
    canEdit,
  }: {
    employees: TeamEmployee[];
    members: TeamMember[];
    weekStart: string;
    bookings: TeamBooking[];
    eventTypes: { id: string; title: string }[];
    canEdit: boolean;
  } = $props();

  // A roster row is an employee, or an org member who is not enrolled yet (so the
  // Roster and the Members tab always list the same people).
  type Row = Omit<TeamEmployee, 'status'> & {
    roles: string;
    status: 'active' | 'left' | 'unenrolled';
    member?: TeamMember;
  };

  let showLeft = $state(false);
  let error = $state<string | null>(null);

  const memberById = $derived(new Map(members.map((mb) => [mb.id, mb])));
  // Org members (person accounts) not yet on the roster — inline rows + the Picker's candidates.
  const enrolled = $derived(new Set(employees.map((e) => e.profileId).filter(Boolean)));
  const candidates = $derived(
    members.filter((mb) => mb.accountType !== 'service' && !enrolled.has(mb.id)),
  );
  const rows = $derived<Row[]>([
    ...employees
      .filter((e) => showLeft || e.status === 'active')
      .map((e) => ({
        ...e,
        roles: (e.profileId && memberById.get(e.profileId)?.role) || '',
      })),
    ...candidates.map((mb): Row => ({
      id: `member:${mb.id}`,
      profileId: mb.id,
      resourceId: null,
      name: mb.displayName || mb.email || 'Team member',
      email: mb.email,
      designation: null,
      status: 'unenrolled',
      joinedOn: null,
      leftOn: null,
      color: null,
      roles: mb.role ?? '',
      member: mb,
    })),
  ]);

  const eventTitle = (id: string) => eventTypes.find((e) => e.id === id)?.title ?? '';
  function stripBookings(resourceId: string | null) {
    if (!resourceId) return [];
    return bookings
      .filter((b) => b.resourceId === resourceId)
      .map((b) => ({
        id: b.id,
        start: b.start,
        end: b.end,
        status: b.status,
        attendeeName: b.attendeeName,
        title: eventTitle(b.eventTypeId),
      }));
  }

  const columns: DataColumn<Row>[] = [
    { key: 'name', label: m.team_col_name(), custom: true, width: 200 },
    { key: 'designation', label: m.team_col_designation(), width: 130 },
    { key: 'roles', label: m.team_col_roles(), width: 90 },
    {
      key: 'status',
      label: m.team_col_status(),
      custom: true,
      width: 100,
      filter: {
        options: () => [
          { value: 'active', label: m.team_status_active() },
          { value: 'left', label: m.team_status_left() },
          { value: 'unenrolled', label: m.team_status_unenrolled() },
        ],
      },
    },
    { key: 'week', label: m.team_col_week(), custom: true, sortable: false, width: 300 },
    { key: 'actions', label: m.team_col_actions(), custom: true, sortable: false, width: 72 },
  ];

  async function patch(id: string, body: Record<string, unknown>) {
    error = null;
    try {
      await jsonMutation({
        input: `/api/scheduling/hr/employees/${id}`,
        init: { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(body) },
        onSuccess: () => invalidate('team:data'),
      });
      return true;
    } catch (e) {
      error = hrErrorMessage(e);
      return false;
    }
  }

  async function enrol(body: Record<string, unknown>) {
    error = null;
    try {
      await jsonMutation({
        input: '/api/scheduling/hr/employees',
        init: { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) },
        onSuccess: () => invalidate('team:data'),
      });
      return true;
    } catch (e) {
      error = hrErrorMessage(e);
      return false;
    }
  }

  // ── Add: org member (Picker) or staff without login (form) ───────────────────
  let pickerOpen = $state(false);
  let staffOpen = $state(false);
  let staffName = $state('');
  let staffEmail = $state('');
  let staffDesignation = $state('');
  let busy = $state(false);

  const addMenu: DropdownItem[] = [
    { value: 'member', label: m.team_add_member() },
    { value: 'staff', label: m.team_add_staff() },
  ];
  const pickerColumns: PickerColumn<TeamMember>[] = [
    {
      key: 'displayName',
      label: m.team_col_name(),
      value: (mb) => mb.displayName ?? mb.email ?? '',
      priority: 10,
      emphasis: 'primary',
      hideable: false,
      searchable: true,
    },
    {
      key: 'email',
      label: m.team_staff_email(),
      value: (mb) => mb.email ?? '',
      priority: 20,
      searchable: true,
    },
  ];
  async function pickMember(mb: TeamMember) {
    busy = true;
    const ok = await enrol({
      name: mb.displayName || mb.email || 'Team member',
      email: mb.email,
      profileId: mb.id,
    });
    busy = false;
    if (ok) pickerOpen = false;
  }
  async function createStaff() {
    if (!staffName.trim()) return;
    busy = true;
    const ok = await enrol({
      name: staffName.trim(),
      email: staffEmail.trim() || null,
      designation: staffDesignation.trim() || null,
      joinedOn: todayKey(),
    });
    busy = false;
    if (ok) {
      staffOpen = false;
      staffName = staffEmail = staffDesignation = '';
    }
  }

  // ── Row actions ──────────────────────────────────────────────────────────────
  let editing = $state<Row | null>(null);
  let editOpen = $state(false);
  let editDesignation = $state('');
  let editJoinedOn = $state('');
  let leaving = $state<Row | null>(null);
  let leaveOpen = $state(false);
  let leftOn = $state(todayKey());

  function rowMenu(r: Row): DropdownItem[] {
    const items: DropdownItem[] = [{ value: 'edit', label: m.team_edit(), icon: Pencil }];
    items.push(
      r.status === 'active'
        ? { value: 'left', label: m.team_mark_left(), icon: UserMinus, danger: true }
        : { value: 'reactivate', label: m.team_reactivate(), icon: UserCheck },
    );
    return items;
  }
  async function onRowAction(r: Row, value: string) {
    if (value === 'edit') {
      editing = r;
      editDesignation = r.designation ?? '';
      editJoinedOn = r.joinedOn ?? '';
      editOpen = true;
    } else if (value === 'left') {
      leaving = r;
      leftOn = todayKey();
      leaveOpen = true;
    } else if (value === 'reactivate') {
      await patch(r.id, { status: 'active', leftOn: null });
    }
  }
  async function saveEdit() {
    if (!editing) return;
    busy = true;
    const ok = await patch(editing.id, {
      designation: editDesignation.trim() || null,
      joinedOn: editJoinedOn || null,
    });
    busy = false;
    if (ok) editOpen = false;
  }
  async function confirmLeft() {
    if (!leaving) return;
    busy = true;
    const ok = await patch(leaving.id, { status: 'left', leftOn });
    busy = false;
    if (ok) leaveOpen = false;
  }
</script>

{#if error}
  <p class="hr-alert" role="alert">{error}</p>
{/if}

<DataTable
  class="flex-1 min-h-0"
  {columns}
  data={rows}
  getRowId={(r) => r.id}
  searchFields={(r) => `${r.name} ${r.email ?? ''} ${r.designation ?? ''}`}
  storageKey="team-roster"
  canEdit={false}
  addLabel={m.team_add()}
  {addMenu}
  onAddSelect={(v) => (v === 'member' ? (pickerOpen = true) : (staffOpen = true))}
  addDisabled={!canEdit}
  emptyMessage={m.team_roster_empty()}
>
  {#snippet toolbar()}
    <Toggle size="sm" bind:checked={showLeft} label={m.team_show_left()} />
  {/snippet}
  {#snippet cell(r: Row, col: DataColumn<Row>)}
    {#if col.key === 'name'}
      <div class="min-w-0">
        <div class="truncate font-medium">{r.name}</div>
        {#if r.email}<div class="t-caption truncate">{r.email}</div>{/if}
      </div>
    {:else if col.key === 'status'}
      {#if r.status === 'unenrolled'}
        <Badge size="sm">{m.team_status_unenrolled()}</Badge>
      {:else}
        <Badge
          variant="semantic"
          value={r.status === 'active' ? 'success' : 'warning'}
          size="sm"
          dot
        >
          {r.status === 'active' ? m.team_status_active() : m.team_status_left()}
        </Badge>
      {/if}
    {:else if col.key === 'week'}
      {#if r.resourceId}
        <MemberCalendarStrip
          compact
          {weekStart}
          bookings={stripBookings(r.resourceId)}
          color={r.color ?? 'var(--color-accent)'}
        />
      {:else}
        <span class="t-caption">—</span>
      {/if}
    {:else if col.key === 'actions'}
      {#if r.member}
        {#if canEdit}
          <Button
            size="xs"
            variant="secondary"
            disabled={busy}
            onclick={() => pickMember(r.member!)}
          >
            {m.team_enrol()}
          </Button>
        {/if}
      {:else if canEdit}
        <Dropdown items={rowMenu(r)} onSelect={(v) => onRowAction(r, v)} placement="left">
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

<Picker
  bind:open={pickerOpen}
  title={m.team_pick_member_title()}
  columns={pickerColumns}
  rows={candidates}
  getRowId={(mb) => mb.id}
  searchText={(mb) => `${mb.displayName ?? ''} ${mb.email ?? ''}`}
  onPick={pickMember}
  emptyLabel={m.team_pick_member_empty()}
  storageKey="team-enrol"
/>

<Modal bind:open={staffOpen} title={m.team_staff_title()} size="sm">
  <div class="hr-form">
    <FormField label={m.team_col_name()} required>
      {#snippet children(control)}
        <Input {...control} bind:value={staffName} />
      {/snippet}
    </FormField>
    <FormField label={m.team_staff_email()}>
      {#snippet children(control)}
        <Input {...control} type="email" bind:value={staffEmail} />
      {/snippet}
    </FormField>
    <FormField label={m.team_col_designation()}>
      {#snippet children(control)}
        <Input {...control} bind:value={staffDesignation} />
      {/snippet}
    </FormField>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (staffOpen = false)}>{m.common_cancel()}</Button>
    <Button onclick={createStaff} disabled={busy || !staffName.trim()}>{m.common_add()}</Button>
  {/snippet}
</Modal>

<Modal bind:open={editOpen} title={m.team_edit()} size="sm">
  <div class="hr-form">
    <FormField label={m.team_col_designation()}>
      {#snippet children(control)}
        <Input {...control} bind:value={editDesignation} />
      {/snippet}
    </FormField>
    <FormField label={m.team_joined_on()}>
      {#snippet children(control)}
        <input {...control} class="hr-date" type="date" bind:value={editJoinedOn} />
      {/snippet}
    </FormField>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (editOpen = false)}>{m.common_cancel()}</Button>
    <Button onclick={saveEdit} disabled={busy}>{m.common_save()}</Button>
  {/snippet}
</Modal>

<Modal bind:open={leaveOpen} title={m.team_mark_left()} size="sm">
  <div class="hr-form">
    <FormField label={m.team_left_on()} required>
      {#snippet children(control)}
        <input {...control} class="hr-date" type="date" bind:value={leftOn} />
      {/snippet}
    </FormField>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (leaveOpen = false)}>{m.common_cancel()}</Button>
    <Button variant="danger" onclick={confirmLeft} disabled={busy || !leftOn}
      >{m.team_mark_left()}</Button
    >
  {/snippet}
</Modal>

<style>
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
</style>
