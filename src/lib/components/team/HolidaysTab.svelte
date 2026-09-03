<script lang="ts">
  import { Trash2 } from 'lucide-svelte';
  import { invalidate } from '$app/navigation';
  import { Checkbox } from '@minion-stack/ui';
  import { Button, Badge, Card, Input, iconSizes } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import DataTable from '$lib/components/data-table/DataTable.svelte';
  import type { DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import * as m from '$lib/paraglide/messages';
  import { languageTag } from '$lib/paraglide/runtime';
  import { jsonMutation } from '$lib/api/json-mutation';
  import { hrErrorMessage } from './hr-error';
  import { JSON_HEADERS, todayKey, type TeamHoliday } from './types';

  let { holidays, canEdit }: { holidays: TeamHoliday[]; canEdit: boolean } = $props();

  const year = new Date().getFullYear();
  let error = $state<string | null>(null);
  let busy = $state(false);

  // Monday-first weekday labels in the user's locale (JS getDay: 0 = Sunday).
  const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0].map((dow) => ({
    dow,
    label: new Intl.DateTimeFormat(languageTag(), { weekday: 'short' }).format(
      new Date(2024, 0, 7 + dow),
    ),
  }));
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

  const columns: DataColumn<TeamHoliday>[] = [
    { key: 'date', label: m.team_holiday_date(), width: 130 },
    { key: 'name', label: m.team_holiday_name() },
    { key: 'weeklyOff', label: m.team_col_status(), custom: true, width: 120 },
    { key: 'actions', label: m.team_col_actions(), custom: true, sortable: false, width: 60 },
  ];

  async function post(body: Record<string, unknown>) {
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
    if (await post({ date: newDate, name: newName.trim() })) newName = '';
  }
  // Reconciles both ways: checked weekdays are materialised, unchecked ones are removed.
  async function applyWeeklyOff() {
    const days = WEEKDAYS.filter((w) => weeklyOff[w.dow]).map((w) => w.dow);
    await post({ weeklyOff: days, from: `${year}-01-01`, to: `${year}-12-31` });
  }
  async function remove(id: string) {
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

<div class="holidays">
  <Card padding="md">
    <div class="t-label mb-2">{m.team_holiday()}</div>
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
</div>

<DataTable
  class="flex-1 min-h-0"
  {columns}
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
          onclick={() => remove(h.id)}
        >
          <Trash2 size={iconSizes.sm} aria-hidden="true" />
        </Button>
      {/if}
    {/if}
  {/snippet}
</DataTable>

<style>
  .holidays {
    display: grid;
    gap: var(--space-4);
    margin-bottom: var(--space-4);
  }
  @media (min-width: 1024px) {
    .holidays {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
