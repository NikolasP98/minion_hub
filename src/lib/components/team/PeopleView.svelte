<script lang="ts">
  // /team → People: one master-detail view for the roster, weekly availability
  // and access. Selection lives in `?person=` so a link/refresh restores it.
  // ≥1024px the detail is the right grid column; below that the SAME snippet
  // renders inside a Sheet over the list (one MediaQuery decides where).
  import type { ComponentProps } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import {
    UserRound,
    UserPlus,
    MoreVertical,
    Pencil,
    LogOut,
    RotateCcw,
    CalendarDays,
  } from 'lucide-svelte';
  import { goto, invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import {
    Button,
    Badge,
    Card,
    EmptyState,
    Input,
    Dropdown,
    Modal,
    Picker,
    Select,
    iconSizes,
  } from '$lib/components/ui';
  import type { DropdownItem, PickerColumn, SelectOption } from '$lib/components/ui';
  import { FormField, Sheet } from '$lib/components/ui/foundations';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import MemberCalendarStrip from '$lib/components/scheduling/MemberCalendarStrip.svelte';
  import AvailabilityEditor from '$lib/components/scheduling/AvailabilityEditor.svelte';
  import MemberAccessControls from '$lib/components/users/MemberAccessControls.svelte';
  import JoinLinkForm from '$lib/components/users/JoinLinkForm.svelte';
  import * as m from '$lib/paraglide/messages';
  import { languageTag } from '$lib/paraglide/runtime';
  import { jsonMutation } from '$lib/api/json-mutation';
  import { hrErrorMessage } from './hr-error';
  import RosterTimelineHeader from './RosterTimelineHeader.svelte';
  import RosterTimelineRow from './RosterTimelineRow.svelte';
  import { Timeline } from './timeline.svelte';
  import { leaveBalances } from './balances';
  import {
    JSON_HEADERS,
    todayKey,
    type LeaveStatus,
    type TeamAllocation,
    type TeamBooking,
    type TeamEmployee,
    type TeamHoliday,
    type TeamHrSettings,
    type TeamLeaveRequest,
    type TeamLeaveType,
    type TeamMember,
    type TeamOrganization,
    type TeamRbacRole,
  } from './types';

  type Schedule = ComponentProps<typeof AvailabilityEditor>['schedule'];

  let {
    employees,
    members,
    weekStart,
    bookings,
    eventTypes,
    schedules,
    rbacRoles = [],
    organizations = [],
    requests,
    allocations,
    leaveTypes,
    holidays,
    hrSettings,
    canEdit,
    canManageUsers,
    onRequestTimeOff,
  }: {
    employees: TeamEmployee[];
    members: TeamMember[];
    weekStart: string;
    bookings: TeamBooking[];
    eventTypes: { id: string; title: string }[];
    schedules: Record<string, Schedule>;
    rbacRoles?: TeamRbacRole[];
    organizations?: TeamOrganization[];
    requests: TeamLeaveRequest[];
    allocations: TeamAllocation[];
    leaveTypes: TeamLeaveType[];
    holidays: TeamHoliday[];
    hrSettings: TeamHrSettings;
    canEdit: boolean;
    canManageUsers: boolean;
    /** Jump to the Time off tab with this employee preselected. */
    onRequestTimeOff: (employeeId: string) => void;
  } = $props();

  // Shared roster timeline (one scroller in the header cell; rows mirror it).
  const tl = new Timeline();
  $effect(() => {
    tl.leaves = requests;
    tl.holidays = holidays;
    tl.weeklyOff = hrSettings.weeklyOff;
    tl.locale = languageTag();
    tl.leaveTypeName = (id) => typeName.get(id) ?? '';
    tl.eventTitle = eventTitle;
  });
  const typeName = $derived(new Map(leaveTypes.map((t) => [t.id, t.name])));
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
  const EMPLOYMENT: Record<string, () => string> = {
    full_time: m.team_employment_full_time,
    part_time: m.team_employment_part_time,
    contract: m.team_employment_contract,
    intern: m.team_employment_intern,
  };
  const employmentOptions: SelectOption[] = [
    { value: '', label: '—' },
    ...Object.keys(EMPLOYMENT).map((value) => ({ value, label: EMPLOYMENT[value]() })),
  ];

  // A roster row is an employee, or an org member who is not enrolled yet (so the
  // roster and the org member list always show the same people).
  type Row = Omit<TeamEmployee, 'status'> & {
    roles: string;
    status: 'active' | 'left' | 'unenrolled';
    member?: TeamMember;
  };

  let showLeft = $state(false);
  let error = $state<string | null>(null);

  const memberById = $derived(new Map(members.map((mb) => [mb.id, mb])));
  // Org RBAC roles (what gates modules), never the platform user/admin flag.
  // memberRoles is only populated for users.manage holders — blank otherwise.
  const roleName = $derived(new Map(rbacRoles.map((r) => [r.key, r.name])));
  const orgRoles = (mb: TeamMember | undefined) =>
    mb ? mb.memberRoles.map((k) => roleName.get(k) ?? k).join(', ') : '';
  // Org members (person accounts) not yet on the roster — inline rows + the Picker's candidates.
  const enrolled = $derived(new Set(employees.map((e) => e.profileId).filter(Boolean)));
  const candidates = $derived(
    members.filter((mb) => mb.accountType !== 'service' && !enrolled.has(mb.id)),
  );
  const allRows = $derived<Row[]>([
    ...employees.map((e) => ({
      ...e,
      roles: orgRoles(e.profileId ? memberById.get(e.profileId) : undefined),
    })),
    ...candidates.map((mb): Row => ({
      id: `member:${mb.id}`,
      profileId: mb.id,
      resourceId: null,
      name: mb.displayName || mb.email || 'Team member',
      email: mb.email,
      designation: null,
      department: null,
      employmentType: null,
      status: 'unenrolled',
      joinedOn: null,
      leftOn: null,
      color: null,
      roles: orgRoles(mb),
      member: mb,
    })),
  ]);
  const rows = $derived(allRows.filter((r) => showLeft || r.status !== 'left'));

  // ── Selection (`?person=<employeeId>` | `member:<profileId>`) ────────────────
  // ≥1024: timeline column in the roster; ≥1536: detail as a side column (else a Sheet) —
  // below that the section nav + detail would leave the timeline under ~6 days.
  const desktop = new MediaQuery('(min-width: 1024px)');
  const wide = new MediaQuery('(min-width: 1536px)');
  const personKey = $derived(page.url.searchParams.get('person'));
  // A just-enrolled `member:<id>` key resolves to the new employee row by profile.
  const selected = $derived.by<Row | null>(() => {
    if (!personKey) return null;
    const direct = allRows.find((r) => r.id === personKey);
    if (direct) return direct;
    const profileId = personKey.startsWith('member:') ? personKey.slice(7) : null;
    return (profileId && allRows.find((r) => r.profileId === profileId)) || null;
  });
  function select(id: string | null) {
    const url = new URL(page.url);
    if (id) url.searchParams.set('person', id);
    else url.searchParams.delete('person');
    goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true, noScroll: true });
  }

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

  const baseColumns = $derived<DataColumn<Row>[]>([
    { key: 'name', label: m.team_col_name(), custom: true, width: 180 },
    // Mostly empty for a clinic-sized team; a column-picker click brings them back.
    { key: 'designation', label: m.team_col_designation(), width: 120, defaultHidden: true },
    { key: 'department', label: m.team_department(), width: 120, defaultHidden: true },
    ...(canManageUsers ? [{ key: 'roles', label: m.team_col_roles(), width: 120 }] : []),
    {
      key: 'status',
      label: m.team_col_status(),
      custom: true,
      width: 96,
      filter: {
        options: () => [
          { value: 'active', label: m.team_status_active() },
          { value: 'left', label: m.team_status_left() },
          { value: 'unenrolled', label: m.team_status_unenrolled() },
        ],
      },
    },
  ]);
  // The timeline is a desktop affordance; on small screens the detail Sheet shows the week strip.
  const columns = $derived<DataColumn<Row>[]>(
    desktop.current
      ? [
          ...baseColumns,
          {
            key: 'timeline',
            label: m.team_col_timeline(),
            custom: true,
            customHeader: true,
            sortable: false,
            resizable: false,
            fill: true,
            width: 220,
          },
        ]
      : baseColumns,
  );

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

  // ── Add: org member (Picker) or staff without login (form) · Invite (join link)
  let pickerOpen = $state(false);
  let staffOpen = $state(false);
  let inviteOpen = $state(false);
  let staffName = $state('');
  let staffEmail = $state('');
  let staffDesignation = $state('');
  let busy = $state(false);

  const addMenu = $derived<DropdownItem[]>([
    { value: 'member', label: m.team_add_member() },
    { value: 'staff', label: m.team_add_staff() },
    ...(canManageUsers
      ? [
          { value: 'd', label: '', divider: true },
          { value: 'invite', label: m.team_invite_link(), icon: UserPlus },
        ]
      : []),
  ]);
  const tableMenu = $derived<DropdownItem[]>([
    { value: 'left', label: showLeft ? m.team_hide_left() : m.team_show_left() },
    { value: 'today', label: m.team_recentre_today(), icon: CalendarDays },
  ]);
  function onTableMenu(v: string) {
    if (v === 'left') showLeft = !showLeft;
    else if (v === 'today') tl.centerToday();
  }
  function onAddSelect(v: string) {
    if (v === 'member') pickerOpen = true;
    else if (v === 'staff') staffOpen = true;
    else if (v === 'invite') inviteOpen = true;
  }
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

  // ── Profile edits (detail panel) ─────────────────────────────────────────────
  let editOpen = $state(false);
  let editDesignation = $state('');
  let editDepartment = $state('');
  let editEmployment = $state('');
  let editJoinedOn = $state('');
  let leaveOpen = $state(false);
  let leftOn = $state(todayKey());

  function openEdit(r: Row) {
    editDesignation = r.designation ?? '';
    editDepartment = r.department ?? '';
    editEmployment = r.employmentType ?? '';
    editJoinedOn = r.joinedOn ?? '';
    editOpen = true;
  }
  function openLeave() {
    leftOn = todayKey();
    leaveOpen = true;
  }
  async function saveEdit() {
    if (!selected) return;
    busy = true;
    const ok = await patch(selected.id, {
      designation: editDesignation.trim() || null,
      department: editDepartment.trim() || null,
      employmentType: editEmployment || null,
      joinedOn: editJoinedOn || null,
    });
    busy = false;
    if (ok) editOpen = false;
  }
  async function confirmLeft() {
    if (!selected) return;
    busy = true;
    const ok = await patch(selected.id, { status: 'left', leftOn });
    busy = false;
    if (ok) leaveOpen = false;
  }

  function personMenu(r: Row): DropdownItem[] {
    if (!canEdit || r.member) return [];
    return r.status === 'active'
      ? [{ value: 'left', label: m.team_mark_left(), icon: LogOut, danger: true }]
      : [{ value: 'reactivate', label: m.team_reactivate(), icon: RotateCcw }];
  }
  function onPersonMenu(r: Row, v: string) {
    if (v === 'left') openLeave();
    else if (v === 'reactivate') void patch(r.id, { status: 'active', leftOn: null });
  }
  // The person's balances (hrms leave balance report) and latest requests.
  const personBalances = (r: Row) =>
    leaveBalances([{ id: r.id, name: r.name }], leaveTypes, allocations, requests);
  const personRequests = (r: Row) =>
    requests
      .filter((q) => q.employeeId === r.id)
      .sort((a, b) => b.fromDate.localeCompare(a.fromDate))
      .slice(0, 3);

  // ── Access: optimistic member-role overrides (MemberAccessControls owns the calls)
  let roleOverrides = $state<Record<string, string[]>>({});
  const rolesOf = (mb: TeamMember) => roleOverrides[mb.id] ?? mb.memberRoles;
  const ownerCount = $derived(members.filter((mb) => rolesOf(mb).includes('owner')).length);
</script>

{#if error}
  <p class="hr-alert" role="alert">{error}</p>
{/if}

<div class="people">
  <DataTable
    class="min-h-0"
    {columns}
    data={rows}
    getRowId={(r) => r.id}
    searchFields={(r) => `${r.name} ${r.email ?? ''} ${r.designation ?? ''}`}
    storageKey="team-roster-v2"
    canEdit={false}
    addLabel={m.team_add()}
    {addMenu}
    {onAddSelect}
    addDisabled={!canEdit && !canManageUsers}
    onRowClick={(r) => select(r.id)}
    emptyMessage={m.team_roster_empty()}
  >
    {#snippet actions()}
      <Dropdown items={tableMenu} onSelect={onTableMenu} placement="left">
        {#snippet trigger()}
          <span class="menu-trigger" aria-label={m.team_col_actions()}>
            <MoreVertical size={iconSizes.md} aria-hidden="true" />
          </span>
        {/snippet}
      </Dropdown>
    {/snippet}
    {#snippet headerCell(col: DataColumn<Row>)}
      {#if col.key === 'timeline'}
        <RosterTimelineHeader {tl} />
      {/if}
    {/snippet}
    {#snippet cell(r: Row, col: DataColumn<Row>)}
      {#if col.key === 'name'}
        <div class="min-w-0 person" class:selected={r.id === selected?.id}>
          <div class="truncate font-medium">{r.name}</div>
          {#if r.email}<div class="t-caption truncate">{r.email}</div>{/if}
        </div>
      {:else if col.key === 'status'}
        {@render statusBadge(r.status)}
      {:else if col.key === 'timeline'}
        {#if r.status !== 'unenrolled'}
          <RosterTimelineRow
            {tl}
            employeeId={r.id}
            resourceId={r.resourceId}
            color={r.color ?? 'var(--color-accent)'}
          />
        {/if}
      {/if}
    {/snippet}
  </DataTable>

  {#if wide.current}
    <Card padding="md" class="detail">
      {#if selected}
        {@render detail(selected)}
      {:else}
        <EmptyState
          icon={UserRound}
          title={m.team_select_person()}
          description={m.team_select_person_hint()}
          compact
        />
      {/if}
    </Card>
  {/if}
</div>

{#if !wide.current && selected}
  <Sheet open title={selected.name} placement="right" size="md" onclose={() => select(null)}>
    {@render detail(selected)}
  </Sheet>
{/if}

{#snippet statusBadge(status: Row['status'])}
  {#if status === 'unenrolled'}
    <Badge size="sm">{m.team_status_unenrolled()}</Badge>
  {:else}
    <Badge variant="semantic" value={status === 'active' ? 'success' : 'warning'} size="sm" dot>
      {status === 'active' ? m.team_status_active() : m.team_status_left()}
    </Badge>
  {/if}
{/snippet}

{#snippet detail(r: Row)}
  {@const mb = r.profileId ? memberById.get(r.profileId) : undefined}
  {@const menu = personMenu(r)}
  <div class="sections">
    <section class="section">
      <div class="profile-head">
        <div class="min-w-0">
          <div class="t-title truncate">{r.name}</div>
          {#if r.email}<div class="t-caption truncate">{r.email}</div>{/if}
        </div>
        <div class="head-actions">
          {@render statusBadge(r.status)}
          {#if canEdit && r.member}
            <Button size="xs" disabled={busy} onclick={() => pickMember(r.member!)}>
              {m.team_enrol()}
            </Button>
          {:else if canEdit}
            <Button
              variant="ghost"
              size="xs"
              shape="icon"
              aria-label={m.team_edit()}
              onclick={() => openEdit(r)}
            >
              <Pencil size={iconSizes.sm} aria-hidden="true" />
            </Button>
          {/if}
          {#if menu.length}
            <Dropdown items={menu} onSelect={(v) => onPersonMenu(r, v)} placement="left">
              {#snippet trigger()}
                <span class="menu-trigger" aria-label={m.team_col_actions()}>
                  <MoreVertical size={iconSizes.md} aria-hidden="true" />
                </span>
              {/snippet}
            </Dropdown>
          {/if}
        </div>
      </div>
      {#if r.status !== 'unenrolled'}
        <dl class="facts">
          <dt>{m.team_col_designation()}</dt>
          <dd>{r.designation || '—'}</dd>
          <dt>{m.team_department()}</dt>
          <dd>{r.department || '—'}</dd>
          <dt>{m.team_employment_type()}</dt>
          <dd>{r.employmentType ? EMPLOYMENT[r.employmentType]?.() : '—'}</dd>
          <dt>{m.team_joined_on()}</dt>
          <dd>{r.joinedOn || '—'}</dd>
          {#if r.leftOn}
            <dt>{m.team_left_on()}</dt>
            <dd>{r.leftOn}</dd>
          {/if}
        </dl>
      {:else}
        <p class="t-caption">{m.team_enrol_hint()}</p>
      {/if}
    </section>

    {#if !desktop.current && r.resourceId}
      <section class="section">
        <h3 class="t-label">{m.team_col_week()}</h3>
        <MemberCalendarStrip
          {weekStart}
          bookings={stripBookings(r.resourceId)}
          color={r.color ?? 'var(--color-accent)'}
        />
      </section>
    {/if}

    {#if r.resourceId}
      <section class="section">
        <!-- AvailabilityEditor renders its own title. -->
        {#key r.resourceId}
          <AvailabilityEditor
            resourceId={r.resourceId}
            schedule={schedules[r.resourceId] ?? null}
          />
        {/key}
      </section>
    {:else if !r.member}
      <section class="section">
        <h3 class="t-label">{m.team_tab_availability()}</h3>
        <p class="t-caption">{m.team_availability_no_resource()}</p>
      </section>
    {/if}

    {#if r.status !== 'unenrolled'}
      {@const bal = personBalances(r)}
      {@const recent = personRequests(r)}
      <section class="section">
        <div class="section-head">
          <h3 class="t-label">{m.team_tab_timeoff()}</h3>
          {#if canEdit && r.status === 'active'}
            <Button size="xs" variant="secondary" onclick={() => onRequestTimeOff(r.id)}>
              {m.team_request()}
            </Button>
          {/if}
        </div>
        {#if bal.length}
          <div class="bal">
            {#each bal as b (b.id)}
              <span class="truncate">{b.type}</span>
              <span class="num">
                <b>{b.available}</b>
                <span class="t-caption">/ {b.allocated}</span>
              </span>
              <span class="bar"
                ><span
                  class="fill"
                  style:width="{b.allocated
                    ? Math.max(0, Math.min(100, (b.available / b.allocated) * 100))
                    : 0}%"
                ></span></span
              >
            {/each}
          </div>
        {:else}
          <p class="t-caption">{m.team_no_allocation()}</p>
        {/if}
        {#if recent.length}
          <ul class="recent">
            {#each recent as q (q.id)}
              <li>
                <span class="tabular-nums"
                  >{q.fromDate}{q.toDate !== q.fromDate ? ` → ${q.toDate}` : ''}</span
                >
                <span class="t-caption truncate">{typeName.get(q.leaveTypeId) ?? '—'}</span>
                <Badge variant="semantic" value={STATUS_TONE[q.status]} size="sm" dot>
                  {STATUS_LABEL[q.status]()}
                </Badge>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}

    {#if canManageUsers}
      <section class="section">
        <h3 class="t-label">{m.team_section_access()}</h3>
        {#if mb}
          <MemberAccessControls
            userId={mb.id}
            platformRole={mb.role}
            memberRoles={rolesOf(mb)}
            {rbacRoles}
            {ownerCount}
            onChange={(roles) => (roleOverrides[mb.id] = roles)}
            onError={(msg) => (error = msg)}
          />
        {:else}
          <p class="t-caption">{m.team_no_login()}</p>
        {/if}
      </section>
    {/if}
  </div>
{/snippet}

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

<Modal bind:open={inviteOpen} title={m.team_invite_title()} size="sm">
  <JoinLinkForm {organizations} />
</Modal>

<Modal bind:open={editOpen} title={m.team_edit()} size="sm">
  <div class="hr-form">
    <FormField label={m.team_col_designation()}>
      {#snippet children(control)}
        <Input {...control} bind:value={editDesignation} />
      {/snippet}
    </FormField>
    <FormField label={m.team_department()}>
      {#snippet children(control)}
        <Input {...control} bind:value={editDepartment} />
      {/snippet}
    </FormField>
    <Select
      label={m.team_employment_type()}
      options={employmentOptions}
      bind:value={editEmployment}
    />
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
  /* One column (list only; detail = Sheet) below 1536px, list + 360px detail above. */
  .people {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    gap: var(--space-4);
    flex: 1;
    min-height: 0;
  }
  @media (min-width: 1536px) {
    .people {
      grid-template-columns: minmax(0, 1fr) minmax(0, 360px);
    }
  }
  .people > :global(*) {
    min-width: 0;
    min-height: 0;
  }
  .people :global(.detail) {
    overflow-y: auto;
  }
  /* List-selection contract: accent text on the selected row's name, never a full fill. */
  .person.selected {
    color: var(--color-accent);
  }
  .sections {
    display: flex;
    flex-direction: column;
    gap: var(--space-section, var(--space-6));
  }
  .section {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .profile-head {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .head-actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    flex-shrink: 0;
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .menu-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-secondary);
    border-radius: var(--radius-sm);
    padding: var(--space-1);
  }
  .menu-trigger:hover {
    background: var(--color-surface-2);
  }
  /* Bar-row contract: label | value | bar LAST on a shared 1fr track. */
  .bal {
    display: grid;
    grid-template-columns: minmax(0, max-content) max-content minmax(3rem, 1fr);
    gap: var(--space-1) var(--space-3);
    align-items: center;
    font-size: var(--font-size-caption);
  }
  .num {
    font-variant-numeric: tabular-nums;
    text-align: right;
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
  .recent {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    font-size: var(--font-size-caption);
  }
  .recent li {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr) max-content;
    gap: var(--space-2);
    align-items: center;
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
