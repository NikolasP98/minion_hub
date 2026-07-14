<script lang="ts">
  import type { PageData } from './$types';
  import {
    Users,
    Plus,
    Trash2,
    ChevronRight,
    CalendarPlus,
    Check,
    Clock,
    MoreVertical,
    Palmtree,
  } from 'lucide-svelte';
  import { invalidate } from '$app/navigation';
  import { PageHeader, Card, Button, Input, EmptyState, Badge, Dropdown } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import type { DropdownItem } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import AvailabilityEditor from '$lib/components/scheduling/AvailabilityEditor.svelte';
  import MemberCalendarStrip from '$lib/components/scheduling/MemberCalendarStrip.svelte';
  import { canAct } from '$lib/access/can.svelte';
  import { jsonMutation, mutationErrorMessage } from '$lib/api/json-mutation';

  let { data }: { data: PageData } = $props();

  type Member = PageData['members'][number];

  const eventTitle = (id: string) => data.eventTypes.find((e) => e.id === id)?.title ?? '';

  // Bookings for one resource this week, with event-type titles resolved.
  function stripBookings(resourceId: string) {
    return data.bookings
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

  // Link each native org member (person accounts) to their scheduling resource.
  const resourceByProfile = $derived(
    new Map(data.resources.filter((r) => r.profileId).map((r) => [r.profileId as string, r])),
  );
  const roster = $derived(
    data.members
      .filter((mb) => mb.accountType !== 'service')
      .map((mb) => ({ member: mb, resource: resourceByProfile.get(mb.id) ?? null })),
  );
  // Resources not tied to an org member: rooms, equipment, manually-added staff.
  const otherResources = $derived(data.resources.filter((r) => !r.profileId));

  let expanded = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let mutationError = $state<string | null>(null);

  function initials(mb: Member): string {
    const src = mb.displayName || mb.email || '?';
    return src
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }

  async function enroll(mb: Member) {
    busy = mb.id;
    mutationError = null;
    try {
      await jsonMutation({
        input: '/api/scheduling/resources',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: mb.displayName || mb.email || 'Team member',
            email: mb.email || null,
            profileId: mb.id,
          }),
        },
        onSuccess: () => invalidate('scheduling:data'),
      });
    } catch (error) {
      mutationError = mutationErrorMessage(error, m.common_error());
    } finally {
      busy = null;
    }
  }

  async function toggleActive(id: string, active: boolean) {
    mutationError = null;
    try {
      await jsonMutation({
        input: `/api/scheduling/resources/${id}`,
        init: {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ active }),
        },
        onSuccess: () => invalidate('scheduling:data'),
      });
    } catch (error) {
      mutationError = mutationErrorMessage(error, m.common_error());
    }
  }

  async function remove(id: string) {
    mutationError = null;
    try {
      await jsonMutation({
        input: `/api/scheduling/resources/${id}`,
        init: { method: 'DELETE' },
        onSuccess: () => invalidate('scheduling:data'),
      });
    } catch (error) {
      mutationError = mutationErrorMessage(error, m.common_error());
    }
  }

  // Per-resource kebab menu. `active` doubles as the vacation flag: available
  // (active) ↔ on vacation (inactive, still enrolled). "Disable scheduling"
  // removes the resource (un-enrols an org member).
  function resourceMenu(active: boolean): DropdownItem[] {
    const items: DropdownItem[] = [];
    if (canAct('scheduling', 'edit')) {
      items.push(
        active
          ? { value: 'vacation', label: m.sched_team_set_vacation(), icon: Palmtree }
          : { value: 'available', label: m.sched_team_set_available(), icon: Check },
      );
    }
    if (canAct('scheduling', 'delete')) {
      if (items.length) items.push({ value: 'd', label: '', divider: true });
      items.push({ value: 'remove', label: m.sched_team_disable(), icon: Trash2, danger: true });
    }
    return items;
  }
  async function onResourceAction(id: string, value: string) {
    if (value === 'vacation') await toggleActive(id, false);
    else if (value === 'available') await toggleActive(id, true);
    else if (value === 'remove') await remove(id);
  }

  // ── Custom (non-user) resource: rooms / equipment ─────────────────────────────
  let showAdd = $state(false);
  let name = $state('');
  let email = $state('');
  let timezone = $state('America/Lima');
  let adding = $state(false);

  async function addCustom() {
    if (!name.trim()) return;
    adding = true;
    mutationError = null;
    try {
      await jsonMutation({
        input: '/api/scheduling/resources',
        init: {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, email: email || null, timezone }),
        },
        onSuccess: async () => {
          name = '';
          email = '';
          showAdd = false;
          await invalidate('scheduling:data');
        },
      });
    } catch (error) {
      mutationError = mutationErrorMessage(error, m.common_error());
    } finally {
      adding = false;
    }
  }
</script>

<svelte:head><title>{m.sched_resources_title()} · {m.nav_scheduling()}</title></svelte:head>

<PageShell
  archetype="collection"
  scroll="region"
  labelledBy="scheduling-resources-title"
  class="scheduling-resources-surface"
>
  <PageHeader
    titleId="scheduling-resources-title"
    title={m.sched_resources_title()}
    subtitle={m.sched_team_subtitle()}
  >
    {#snippet leading()}
      <Users size={16} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>

  <PageBody padding="compact" scroll="region" class="flex flex-col gap-4">
    {#if mutationError}
      <p
        class="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        role="alert"
      >
        {mutationError}
      </p>
    {/if}
    {#if showAdd}
      <Card padding="md">
        <div class="t-label mb-2">{m.sched_team_add_custom()}</div>
        <div class="flex flex-wrap items-end gap-2">
          <label class="field">
            <span class="t-caption">{m.sched_resource_name()}</span>
            <Input bind:value={name} placeholder="Sala 1 / Equipo…" />
          </label>
          <label class="field">
            <span class="t-caption">{m.sched_resource_email()}</span>
            <Input bind:value={email} placeholder="email@…" />
          </label>
          <label class="field">
            <span class="t-caption">{m.sched_resource_timezone()}</span>
            <Input bind:value={timezone} />
          </label>
          <Button
            onclick={addCustom}
            disabled={adding || !name.trim() || !canAct('scheduling', 'edit')}
            title={canAct('scheduling', 'edit') ? undefined : m.no_permission()}
          >
            <Plus size={14} />
            {m.sched_resource_new()}
          </Button>
        </div>
      </Card>
    {/if}

    <!-- ── Native org members ──────────────────────────────────────────────── -->
    <section class="flex flex-col gap-2">
      <div class="flex items-center justify-between gap-2">
        <div class="t-label">{m.sched_team_members_heading()}</div>
        <Button
          variant="ghost"
          size="sm"
          class="add-link"
          disabled={!canAct('scheduling', 'edit')}
          title={canAct('scheduling', 'edit') ? undefined : m.no_permission()}
          onclick={() => (showAdd = !showAdd)}
        >
          <Plus size={13} />
          {m.sched_team_add_custom()}
        </Button>
      </div>

      {#if roster.length === 0}
        <EmptyState title={m.sched_team_no_members()} />
      {:else}
        {#each roster as { member, resource } (member.id)}
          {@const color = resource?.color ?? 'var(--accent)'}
          <Card padding="md">
            <div class="flex items-center gap-3">
              {#if resource}
                <Button
                  variant="ghost"
                  size="sm"
                  class="icon-btn"
                  onclick={() => (expanded = expanded === resource.id ? null : resource.id)}
                  aria-label="toggle"
                >
                  <ChevronRight
                    size={16}
                    style="transform:rotate({expanded === resource.id
                      ? 90
                      : 0}deg);transition:transform var(--duration-fast)"
                  />
                </Button>
              {:else}
                <span class="icon-btn-spacer"></span>
              {/if}

              <span class="avatar" style="--c:{color}">{initials(member)}</span>

              <div class="flex-1 min-w-0">
                <div class="font-medium truncate flex items-center gap-2">
                  {member.displayName || member.email || '—'}
                  {#if member.role === 'admin'}<Badge variant="semantic" value="brand" size="sm"
                      >admin</Badge
                    >{/if}
                </div>
                <div class="t-caption truncate">
                  {member.email ?? ''}{#if resource}
                    · {resource.timezone}{/if}
                </div>
              </div>

              {#if resource}
                {@const res = resource}
                <Badge variant="semantic" value={res.active ? 'success' : 'warning'} size="sm" dot>
                  {res.active ? m.sched_team_enrolled() : m.sched_team_on_vacation()}
                </Badge>
                <Dropdown
                  items={resourceMenu(res.active)}
                  onSelect={(v) => onResourceAction(res.id, v)}
                  placement="left"
                >
                  {#snippet trigger()}
                    <span class="icon-btn" aria-label={m.sched_team_actions()}
                      ><MoreVertical size={16} /></span
                    >
                  {/snippet}
                </Dropdown>
              {:else}
                <Button
                  size="sm"
                  onclick={() => enroll(member)}
                  disabled={busy === member.id || !canAct('scheduling', 'edit')}
                  title={canAct('scheduling', 'edit') ? undefined : m.no_permission()}
                >
                  <CalendarPlus size={14} />
                  {m.sched_team_enable()}
                </Button>
              {/if}
            </div>

            {#if resource && expanded === resource.id}
              <div
                class="mt-3 pt-3 border-t border-[var(--hairline)] grid gap-4 lg:grid-cols-[1fr_auto]"
              >
                <div class="min-w-0">
                  <div class="t-label mb-2 flex items-center gap-1.5">
                    <CalendarPlus size={13} class="text-accent" />
                    {m.sched_team_this_week()}
                  </div>
                  <MemberCalendarStrip
                    weekStart={data.weekStart}
                    bookings={stripBookings(resource.id)}
                    {color}
                  />
                </div>
                <div class="lg:border-l lg:pl-4 border-[var(--hairline)] min-w-[220px]">
                  <div class="t-label mb-2 flex items-center gap-1.5">
                    <Clock size={13} class="text-accent" />
                    {m.sched_availability_title()}
                  </div>
                  <AvailabilityEditor
                    resourceId={resource.id}
                    schedule={data.schedules[resource.id]}
                  />
                </div>
              </div>
            {/if}
          </Card>
        {/each}
      {/if}
    </section>

    <!-- ── Other resources (rooms / equipment / manual) ────────────────────── -->
    {#if otherResources.length > 0}
      <section class="flex flex-col gap-2">
        <div class="t-label">{m.sched_team_other_resources()}</div>
        {#each otherResources as r (r.id)}
          {@const color = r.color ?? 'var(--accent)'}
          <Card padding="md">
            <div class="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                class="icon-btn"
                onclick={() => (expanded = expanded === r.id ? null : r.id)}
                aria-label="toggle"
              >
                <ChevronRight
                  size={16}
                  style="transform:rotate({expanded === r.id
                    ? 90
                    : 0}deg);transition:transform var(--duration-fast)"
                />
              </Button>
              <span class="avatar room" style="--c:{color}"><Check size={14} /></span>
              <div class="flex-1 min-w-0">
                <div class="font-medium truncate">{r.name}</div>
                <div class="t-caption truncate">{r.email ?? ''} · {r.timezone}</div>
              </div>
              <Badge variant="semantic" value={r.active ? 'success' : 'warning'} size="sm" dot>
                {r.active ? m.sched_resource_active() : m.sched_team_on_vacation()}
              </Badge>
              <Dropdown
                items={resourceMenu(r.active)}
                onSelect={(v) => onResourceAction(r.id, v)}
                placement="left"
              >
                {#snippet trigger()}
                  <span class="icon-btn" aria-label={m.sched_team_actions()}
                    ><MoreVertical size={16} /></span
                  >
                {/snippet}
              </Dropdown>
            </div>
            {#if expanded === r.id}
              <div
                class="mt-3 pt-3 border-t border-[var(--hairline)] grid gap-4 lg:grid-cols-[1fr_auto]"
              >
                <div class="min-w-0">
                  <div class="t-label mb-2">{m.sched_team_this_week()}</div>
                  <MemberCalendarStrip
                    weekStart={data.weekStart}
                    bookings={stripBookings(r.id)}
                    {color}
                  />
                </div>
                <div class="lg:border-l lg:pl-4 border-[var(--hairline)] min-w-[220px]">
                  <div class="t-label mb-2">{m.sched_availability_title()}</div>
                  <AvailabilityEditor resourceId={r.id} schedule={data.schedules[r.id]} />
                </div>
              </div>
            {/if}
          </Card>
        {/each}
      </section>
    {/if}
  </PageBody>
</PageShell>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--color-muted-foreground);
    border-radius: var(--radius-sm);
    padding: var(--space-1, 4px);
  }
  .icon-btn:hover {
    background: var(--hairline);
  }
  .icon-btn-spacer {
    width: 26px;
    display: inline-block;
  }
  .avatar {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
    font-size: var(--font-size-caption, 12px);
    font-weight: 600;
    color: var(--c);
    background: color-mix(in srgb, var(--c) 16%, transparent);
    border: 1px solid color-mix(in srgb, var(--c) 40%, transparent);
  }
  .avatar.room {
    border-radius: var(--radius-md, 8px);
  }
</style>
