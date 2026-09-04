<script lang="ts">
  // /team — the HR system of record (spec 2026-09-02-hub-team-hr-module-spec):
  // People (roster · availability · access) · Time off (calendar · requests ·
  // balances) · Rooms & equipment · Settings (holidays · weekly off · leave
  // types · allocations). The secondary side menu (TeamNav) switches `?tab=`.
  import type { PageData } from './$types';
  import { Users } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { PageHeader, EmptyState, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import PeopleView from '$lib/components/team/PeopleView.svelte';
  import TimeOffView from '$lib/components/team/TimeOffView.svelte';
  import ResourcesTab from '$lib/components/team/ResourcesTab.svelte';
  import TeamSettingsView from '$lib/components/team/TeamSettingsView.svelte';
  import { resolveTeamTab } from '$lib/components/team/tabs';
  import { canAct, canClient } from '$lib/access/can.svelte';
  import * as m from '$lib/paraglide/messages';

  let { data }: { data: PageData } = $props();

  const canManageUsers = $derived(canClient('users.manage'));
  const canEdit = $derived(canAct('scheduling', 'edit'));
  const tab = $derived(resolveTeamTab(page.url.searchParams.get('tab'), canEdit || canManageUsers));
  const TITLES = {
    people: m.team_tab_people,
    timeoff: m.team_tab_timeoff,
    resources: m.team_tab_resources,
    settings: m.team_tab_settings,
  } as const;
  // People → "Request" jumps to Time off with the employee preselected.
  const requestFor = $derived(page.url.searchParams.get('request'));
  function requestTimeOff(employeeId: string) {
    const url = new URL(page.url);
    url.search = '';
    url.searchParams.set('tab', 'timeoff');
    url.searchParams.set('request', employeeId);
    goto(`${url.pathname}${url.search}`, { keepFocus: true, noScroll: true });
  }
</script>

<svelte:head>
  <title>{TITLES[tab]()} · {m.team_title()} · Minion</title>
</svelte:head>

<PageShell archetype="collection" scroll="region" labelledBy="team-title">
  <PageHeader titleId="team-title" title={TITLES[tab]()} subtitle={m.team_subtitle()}>
    {#snippet leading()}
      <Users size={iconSizes.md} class="text-accent shrink-0" aria-hidden="true" />
    {/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region" class="team-body">
    {#if !data.hrEnabled}
      <EmptyState icon={Users} title={m.team_hr_disabled()} />
    {:else if tab === 'people'}
      <PeopleView
        employees={data.employees}
        members={data.members}
        weekStart={data.weekStart}
        bookings={data.bookings}
        eventTypes={data.eventTypes}
        schedules={data.schedules}
        rbacRoles={data.rbacRoles}
        organizations={data.organizations}
        requests={data.requests}
        allocations={data.allocations}
        leaveTypes={data.leaveTypes}
        holidays={data.holidays}
        hrSettings={data.hrSettings}
        {canEdit}
        {canManageUsers}
        onRequestTimeOff={requestTimeOff}
      />
    {:else if tab === 'timeoff'}
      <TimeOffView
        employees={data.employees}
        leaveTypes={data.leaveTypes}
        allocations={data.allocations}
        requests={data.requests}
        holidays={data.holidays}
        hrSettings={data.hrSettings}
        members={data.members}
        {canEdit}
        canDecide={canEdit || canManageUsers}
        myEmployeeId={data.myEmployeeId}
        {requestFor}
      />
    {:else if tab === 'resources'}
      <ResourcesTab resources={data.resources} schedules={data.schedules} {canEdit} />
    {:else}
      <TeamSettingsView
        employees={data.employees}
        holidays={data.holidays}
        hrSettings={data.hrSettings}
        leaveTypes={data.leaveTypes}
        allocations={data.allocations}
        {canEdit}
      />
    {/if}
  </PageBody>
</PageShell>

<style>
  :global(.team-body) {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  /* Shared HR form chrome for the tab components (scoped styles don't cross components). */
  :global(.hr-alert) {
    border-radius: var(--radius-md);
    border: 1px solid var(--color-danger-border);
    background: var(--color-danger-surface);
    color: var(--color-danger-fg);
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-size-caption);
  }
  :global(.hr-form) {
    display: flex;
    flex-direction: column;
    gap: var(--space-field-gap, var(--space-3));
  }
  :global(.hr-inline) {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: var(--space-2);
  }
  :global(.hr-date) {
    height: var(--control-height-md);
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font: inherit;
  }
</style>
