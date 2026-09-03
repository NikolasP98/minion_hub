<script lang="ts">
  // /team — the HR system of record (spec 2026-09-02-hub-team-hr-module-spec):
  // Roster · Availability · Time off · Holidays, plus the existing Members &
  // access panels (TeamTab + SharedAccountsPanel) for users.manage holders.
  import type { PageData } from './$types';
  import { Users } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import TeamTab from '$lib/components/users/TeamTab.svelte';
  import SharedAccountsPanel from '$lib/components/users/SharedAccountsPanel.svelte';
  import { PageHeader, SegmentedControl, EmptyState, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import RosterTab from '$lib/components/team/RosterTab.svelte';
  import AvailabilityTab from '$lib/components/team/AvailabilityTab.svelte';
  import TimeOffTab from '$lib/components/team/TimeOffTab.svelte';
  import HolidaysTab from '$lib/components/team/HolidaysTab.svelte';
  import ResourcesTab from '$lib/components/team/ResourcesTab.svelte';
  import { canAct, canClient } from '$lib/access/can.svelte';
  import * as m from '$lib/paraglide/messages';

  let { data }: { data: PageData } = $props();

  const canManageUsers = $derived(canClient('users.manage'));
  const canEdit = $derived(canAct('scheduling', 'edit'));
  // Members & access is always listed; without users.manage it explains the gate instead of vanishing.
  const tabs = $derived([
    ...(data.hrEnabled
      ? [
          { value: 'roster', label: m.team_tab_roster() },
          { value: 'availability', label: m.team_tab_availability() },
          { value: 'timeoff', label: m.team_tab_timeoff() },
          { value: 'holidays', label: m.team_tab_holidays() },
          { value: 'resources', label: m.team_tab_resources() },
        ]
      : []),
    { value: 'members', label: m.team_tab_members() },
  ]);
  // `?tab=` is the source of truth; unknown/missing falls back to the first visible tab.
  const tab = $derived.by(() => {
    const q = page.url.searchParams.get('tab');
    return tabs.some((t) => t.value === q) ? (q as string) : (tabs[0]?.value ?? '');
  });
  function selectTab(value: string) {
    const url = new URL(page.url);
    url.searchParams.set('tab', value);
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
    {#if tab === 'roster'}
      <RosterTab
        employees={data.employees}
        members={data.members}
        weekStart={data.weekStart}
        bookings={data.bookings}
        eventTypes={data.eventTypes}
        {canEdit}
      />
    {:else if tab === 'availability'}
      <AvailabilityTab employees={data.employees} schedules={data.schedules} />
    {:else if tab === 'timeoff'}
      <TimeOffTab
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
    {:else if tab === 'holidays'}
      <HolidaysTab holidays={data.holidays} {canEdit} />
    {:else if tab === 'resources'}
      <ResourcesTab resources={data.resources} schedules={data.schedules} {canEdit} />
    {:else if tab === 'members'}
      {#if canManageUsers}
        <div class="team-stack">
          <TeamTab />
          <SharedAccountsPanel />
        </div>
      {:else}
        <EmptyState
          icon={Users}
          title={m.team_members_locked()}
          description={m.team_members_locked_hint()}
        />
      {/if}
    {:else}
      <EmptyState title={m.team_hr_disabled()} />
    {/if}
  </PageBody>
</PageShell>

<style>
  .team-stack {
    display: grid;
    align-content: start;
    gap: var(--space-section, 24px);
  }
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
