<script lang="ts">
  // /team — the HR system of record (spec 2026-09-02-hub-team-hr-module-spec):
  // People (roster · availability · access) · Time off (requests · holidays) ·
  // Rooms & equipment. Members & shared accounts live under /settings/team.
  import type { PageData } from './$types';
  import { Users } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { PageHeader, SegmentedControl, EmptyState, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import PeopleView from '$lib/components/team/PeopleView.svelte';
  import TimeOffView from '$lib/components/team/TimeOffView.svelte';
  import ResourcesTab from '$lib/components/team/ResourcesTab.svelte';
  import { canAct, canClient } from '$lib/access/can.svelte';
  import * as m from '$lib/paraglide/messages';

  let { data }: { data: PageData } = $props();

  const canManageUsers = $derived(canClient('users.manage'));
  const canEdit = $derived(canAct('scheduling', 'edit'));
  const tabs = $derived(
    data.hrEnabled
      ? [
          { value: 'people', label: m.team_tab_people() },
          { value: 'timeoff', label: m.team_tab_timeoff() },
          { value: 'resources', label: m.team_tab_resources() },
        ]
      : [],
  );
  // Pre-fold tab values (bookmarks, assistant links) still resolve.
  const LEGACY: Record<string, string> = {
    roster: 'people',
    availability: 'people',
    members: 'people',
    holidays: 'timeoff',
  };
  // `?tab=` is the source of truth; unknown/missing falls back to People.
  const tab = $derived.by(() => {
    const q = page.url.searchParams.get('tab') ?? '';
    const v = LEGACY[q] ?? q;
    return tabs.some((t) => t.value === v) ? v : (tabs[0]?.value ?? '');
  });
  function selectTab(value: string) {
    const url = new URL(page.url);
    url.searchParams.set('tab', value);
    // A person selection belongs to the People tab only.
    if (value !== 'people') url.searchParams.delete('person');
    goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true, noScroll: true });
  }
</script>

<svelte:head>
  <title>{m.team_title()} · Minion</title>
</svelte:head>

<PageShell archetype="collection" scroll="region" labelledBy="team-title">
  <PageHeader titleId="team-title" title={m.team_title()} subtitle={m.team_subtitle()}>
    {#snippet leading()}
      <Users size={iconSizes.md} class="text-accent shrink-0" aria-hidden="true" />
    {/snippet}
    {#snippet actions()}
      {#if tabs.length > 1}
        <SegmentedControl
          items={tabs}
          value={tab}
          onValueChange={selectTab}
          aria-label={m.team_title()}
        />
      {/if}
    {/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region" class="team-body">
    {#if tab === 'people'}
      <PeopleView
        employees={data.employees}
        members={data.members}
        weekStart={data.weekStart}
        bookings={data.bookings}
        eventTypes={data.eventTypes}
        schedules={data.schedules}
        rbacRoles={data.rbacRoles}
        organizations={data.organizations}
        {canEdit}
        {canManageUsers}
      />
    {:else if tab === 'timeoff'}
      <TimeOffView
        employees={data.employees}
        leaveTypes={data.leaveTypes}
        allocations={data.allocations}
        requests={data.requests}
        holidays={data.holidays}
        members={data.members}
        {canEdit}
        canDecide={canEdit || canManageUsers}
        myEmployeeId={data.myEmployeeId}
      />
    {:else if tab === 'resources'}
      <ResourcesTab resources={data.resources} schedules={data.schedules} {canEdit} />
    {:else}
      <EmptyState icon={Users} title={m.team_hr_disabled()} />
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
