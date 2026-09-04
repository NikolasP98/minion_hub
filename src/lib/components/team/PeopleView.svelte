<script lang="ts">
  // /team → People: one master-detail view for the roster, weekly availability
  // and access. Selection lives in `?person=` so a link/refresh restores it.
  // ≥1024px the detail is the right grid column; below that the SAME snippet
  // renders inside a Sheet over the list (one MediaQuery decides where).
  import type { ComponentProps } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { UserRound, UserPlus } from 'lucide-svelte';
  import { goto, invalidate } from '$app/navigation';
  import { page } from '$app/state';
  import {
    Button,
    Badge,
    Card,
    EmptyState,
    Input,
    Modal,
    Picker,
    Toggle,
    iconSizes,
  } from '$lib/components/ui';
  import type { DropdownItem, PickerColumn } from '$lib/components/ui';
  import { FormField, Sheet } from '$lib/components/ui/foundations';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import MemberCalendarStrip from '$lib/components/scheduling/MemberCalendarStrip.svelte';
  import AvailabilityEditor from '$lib/components/scheduling/AvailabilityEditor.svelte';
  import MemberAccessControls from '$lib/components/users/MemberAccessControls.svelte';
  import JoinLinkForm from '$lib/components/users/JoinLinkForm.svelte';
  import * as m from '$lib/paraglide/messages';
  import { jsonMutation } from '$lib/api/json-mutation';
  import { hrErrorMessage } from './hr-error';
  import {
    JSON_HEADERS,
    todayKey,
    type TeamBooking,
    type TeamEmployee,
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
    canEdit,
    canManageUsers,
  }: {
    employees: TeamEmployee[];
    members: TeamMember[];
    weekStart: string;
    bookings: TeamBooking[];
    eventTypes: { id: string; title: string }[];
    schedules: Record<string, Schedule>;
    rbacRoles?: TeamRbacRole[];
    organizations?: TeamOrganization[];
    canEdit: boolean;
    canManageUsers: boolean;
  } = $props();

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
  // Org members (person accounts) not yet on the roster — inline rows + the Picker's candidates.
  const enrolled = $derived(new Set(employees.map((e) => e.profileId).filter(Boolean)));
  const candidates = $derived(
    members.filter((mb) => mb.accountType !== 'service' && !enrolled.has(mb.id)),
  );
  const allRows = $derived<Row[]>([
    ...employees.map((e) => ({
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
  const rows = $derived(allRows.filter((r) => showLeft || r.status !== 'left'));

  // ── Selection (`?person=<employeeId>` | `member:<profileId>`) ────────────────
  const desktop = new MediaQuery('(min-width: 1024px)');
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

  // ── Add: org member (Picker) or staff without login (form) · Invite (join link)
  let pickerOpen = $state(false);
  let staffOpen = $state(false);
  let inviteOpen = $state(false);
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

  // ── Profile edits (detail panel) ─────────────────────────────────────────────
  let editOpen = $state(false);
  let editDesignation = $state('');
  let editJoinedOn = $state('');
  let leaveOpen = $state(false);
  let leftOn = $state(todayKey());

  function openEdit(r: Row) {
    editDesignation = r.designation ?? '';
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
    storageKey="team-roster"
    canEdit={false}
    addLabel={m.team_add()}
    {addMenu}
    onAddSelect={(v) => (v === 'member' ? (pickerOpen = true) : (staffOpen = true))}
    addDisabled={!canEdit}
    onRowClick={(r) => select(r.id)}
    emptyMessage={m.team_roster_empty()}
  >
    {#snippet toolbar()}
      <Toggle size="sm" bind:checked={showLeft} label={m.team_show_left()} />
      {#if canManageUsers}
        <Button size="sm" variant="secondary" onclick={() => (inviteOpen = true)}>
          <UserPlus size={iconSizes.sm} aria-hidden="true" />
          {m.team_invite()}
        </Button>
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
        {#if r.member && canEdit}
          <Button
            size="xs"
            variant="secondary"
            disabled={busy}
            onclick={(e: MouseEvent) => {
              e.stopPropagation();
              pickMember(r.member!);
            }}
          >
            {m.team_enrol()}
          </Button>
        {/if}
      {/if}
    {/snippet}
  </DataTable>

  {#if desktop.current}
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

{#if !desktop.current && selected}
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
  <div class="sections">
    <section class="section">
      <h3 class="t-label">{m.team_section_profile()}</h3>
      <div class="profile-head">
        <div class="min-w-0">
          <div class="t-title truncate">{r.name}</div>
          {#if r.email}<div class="t-caption truncate">{r.email}</div>{/if}
        </div>
        {@render statusBadge(r.status)}
      </div>
      {#if r.status !== 'unenrolled'}
        <dl class="facts">
          <dt>{m.team_col_designation()}</dt>
          <dd>{r.designation || '—'}</dd>
          <dt>{m.team_joined_on()}</dt>
          <dd>{r.joinedOn || '—'}</dd>
          {#if r.leftOn}
            <dt>{m.team_left_on()}</dt>
            <dd>{r.leftOn}</dd>
          {/if}
        </dl>
      {/if}
      {#if canEdit}
        <div class="hr-inline">
          {#if r.member}
            <Button size="sm" disabled={busy} onclick={() => pickMember(r.member!)}>
              {m.team_enrol()}
            </Button>
          {:else}
            <Button size="sm" variant="secondary" onclick={() => openEdit(r)}
              >{m.team_edit()}</Button
            >
            {#if r.status === 'active'}
              <Button size="sm" variant="danger" onclick={openLeave}>{m.team_mark_left()}</Button>
            {:else}
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onclick={() => patch(r.id, { status: 'active', leftOn: null })}
              >
                {m.team_reactivate()}
              </Button>
            {/if}
          {/if}
        </div>
      {/if}
    </section>

    <section class="section">
      <!-- AvailabilityEditor renders its own title; only label the fallbacks. -->
      {#if !r.resourceId}<h3 class="t-label">{m.team_tab_availability()}</h3>{/if}
      {#if r.resourceId}
        {#key r.resourceId}
          <AvailabilityEditor
            resourceId={r.resourceId}
            schedule={schedules[r.resourceId] ?? null}
          />
        {/key}
      {:else if r.member}
        <p class="t-caption">{m.team_enrol_hint()}</p>
      {:else}
        <p class="t-caption">{m.team_availability_no_resource()}</p>
      {/if}
    </section>

    {#if canManageUsers}
      <section class="section">
        <h3 class="t-label">{m.team_section_access()}</h3>
        {#if mb}
          <dl class="facts">
            <dt>{m.team_platform_role()}</dt>
            <dd>{mb.role ?? 'user'}</dd>
            <dt>{m.team_col_roles()}</dt>
            <dd>
              <MemberAccessControls
                userId={mb.id}
                platformRole={mb.role}
                memberRoles={rolesOf(mb)}
                {rbacRoles}
                {ownerCount}
                onChange={(roles) => (roleOverrides[mb.id] = roles)}
                onError={(msg) => (error = msg)}
              />
            </dd>
          </dl>
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
  /* One column (list only; detail = Sheet) below 1024px, list + ~400px detail above. */
  .people {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    gap: var(--space-4);
    flex: 1;
    min-height: 0;
  }
  @media (min-width: 1024px) {
    .people {
      grid-template-columns: minmax(0, 1fr) minmax(0, 400px);
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
