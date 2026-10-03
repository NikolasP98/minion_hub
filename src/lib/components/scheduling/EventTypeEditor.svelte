<script lang="ts">
  import { Select } from '$lib/components/ui';

  import { Button, Toggle } from '$lib/components/ui';
  import WeekHoursEditor from './WeekHoursEditor.svelte';
  import ResourcePickerField, { type SchedulableResource } from './ResourcePickerField.svelte';
  import ProcedurePickerField from './ProcedurePickerField.svelte';
  import TagsField from '$lib/components/tags/TagsField.svelte';
  import { AttachmentButton, AttachmentList } from '$lib/components/attachments';
  import { canAct } from '$lib/access/can.svelte';
  import type { CalKind, CalTag } from '$lib/components/scheduling/calendar/types';
  import * as m from '$lib/paraglide/messages';
  import { tryUseActions } from '$lib/services/actions/context';
  import {
    requireOk,
    runCompoundMutation,
    runTrackedCommand,
  } from '$lib/services/actions/mutations';

  interface EventType {
    id?: string;
    slug: string;
    title: string;
    description: string | null;
    length: number;
    slotInterval: number | null;
    beforeBuffer: number;
    afterBuffer: number;
    minimumBookingNotice: number;
    periodDays: number | null;
    schedulingType: string | null;
    useCustomSchedule: boolean;
    scheduleRules: Array<{ days: number[]; startTime: string; endTime: string }>;
    requiresConfirmation: boolean;
    public: boolean;
    productId: string | null;
    resourceIds: string[];
    kindId: string | null;
  }
  let {
    eventType = null,
    preset = null,
    resources,
    products,
    kinds = [],
    tags = [],
    tagIds: initialTagIds = [],
    onsaved,
    oncancel,
  }: {
    eventType?: EventType | null;
    /** Seeds a NEW event type (e.g. from a dormant catalog service). */
    preset?: Partial<EventType> | null;
    resources: SchedulableResource[];
    products: Array<{ id: string; name: string }>;
    /** Org-defined event kinds (`sched_event_kinds`) — the calendar category. */
    kinds?: CalKind[];
    /** Org-wide manual tags. */
    tags?: CalTag[];
    /** Tag ids already applied to this event type (edit mode). */
    tagIds?: string[];
    onsaved: () => void;
    oncancel: () => void;
  } = $props();

  const slugify = (s: string) =>
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  // svelte-ignore state_referenced_locally
  let f = $state<EventType>(
    eventType
      ? { ...eventType }
      : {
          title: '',
          description: null,
          length: 15,
          slotInterval: null,
          beforeBuffer: 0,
          afterBuffer: 0,
          minimumBookingNotice: 120,
          periodDays: 30,
          schedulingType: null,
          useCustomSchedule: false,
          scheduleRules: [],
          requiresConfirmation: false,
          public: true,
          productId: null,
          resourceIds: [],
          kindId: kinds.find((k) => k.isDefault)?.id ?? null,
          ...preset,
          slug: preset?.slug ?? slugify(preset?.title ?? ''),
        },
  );
  // svelte-ignore state_referenced_locally
  let slugTouched = $state(!!eventType);
  // svelte-ignore state_referenced_locally
  let tagIds = $state<string[]>(initialTagIds);
  let saving = $state(false);
  let err = $state<string | null>(null);
  let attachmentsRefreshKey = $state(0);
  const actions = tryUseActions();
  let tagRepair = $state<{ savedId: string; tagIds: string[] } | null>(null);
  let primaryUnknown = $state(false);
  let repairScopeVersion = actions?.scopeVersion;
  let repairOwnerKey: string | undefined;

  $effect(() => {
    const scopeVersion = actions?.scopeVersion;
    if (scopeVersion === repairScopeVersion) return;
    repairScopeVersion = scopeVersion;
    tagRepair = null;
    primaryUnknown = false;
    saving = false;
    err = null;
  });

  $effect(() => {
    const ownerKey = eventType?.id ?? `new:${preset?.slug ?? preset?.title ?? ''}`;
    if (ownerKey === repairOwnerKey) return;
    repairOwnerKey = ownerKey;
    tagRepair = null;
    primaryUnknown = false;
    saving = false;
    err = null;
  });

  // Per-service weekly schedule (only used when f.useCustomSchedule). 0=Sun…6=Sat.
  type DayState = { enabled: boolean; start: string; end: string };
  function buildWeek(rules: EventType['scheduleRules']): DayState[] {
    const week: DayState[] = Array.from({ length: 7 }, () => ({
      enabled: false,
      start: '09:00',
      end: '17:00',
    }));
    for (const r of rules ?? [])
      for (const d of r.days)
        if (d >= 0 && d <= 6) week[d] = { enabled: true, start: r.startTime, end: r.endTime };
    return week;
  }
  const weekToRules = (w: DayState[]) =>
    w
      .map((d, i) => ({ d, i }))
      .filter((x) => x.d.enabled)
      .map((x) => ({ days: [x.i], startTime: x.d.start, endTime: x.d.end }));
  // svelte-ignore state_referenced_locally
  let week = $state<DayState[]>(buildWeek(f.scheduleRules));

  function onTitle(v: string) {
    f.title = v;
    if (!slugTouched) f.slug = slugify(v);
  }
  const canSave = $derived(canAct('scheduling', 'manage') && canAct('scheduling', 'edit'));
  async function save() {
    if (!canSave || saving || primaryUnknown) return;
    if (!f.title.trim() || !f.slug.trim() || f.length <= 0) {
      err = 'title, slug, length required';
      return;
    }
    saving = true;
    err = null;
    // Sync the weekly editor into the payload (empty when not using a custom schedule).
    f.scheduleRules = f.useCustomSchedule ? weekToRules(week) : [];
    const repair = tagRepair;
    const tagSnapshot = repair?.tagIds ?? [...tagIds];
    const scopeVersion = actions?.scopeVersion;
    try {
      const outcome = await runTrackedCommand(actions, 'scheduling.event-type.save', (context) =>
        runCompoundMutation({
          context,
          committed: repair?.savedId,
          primaryAttemptId: 'scheduling.event-type.save.primary',
          primary: async (signal) => {
            const url = eventType?.id
              ? `/api/scheduling/event-types/${eventType.id}`
              : '/api/scheduling/event-types';
            const response = await fetch(url, {
              method: eventType?.id ? 'PATCH' : 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(f),
              signal,
            });
            await requireOk(response, m.data_table_save_failed());
            return eventType?.id ?? ((await response.json()) as { id: string }).id;
          },
          followupAttemptId: 'scheduling.event-type.save.tags',
          followup: async (savedId, signal) => {
            const response = await fetch(`/api/tags/event_type/${savedId}`, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ tagIds: tagSnapshot }),
              signal,
            });
            await requireOk(response, m.data_table_bulk_tags_failed());
          },
          onPrimaryCommitted: (savedId) => {
            tagRepair = { savedId, tagIds: tagSnapshot };
          },
          onFollowupCommitted: () => {
            tagRepair = null;
            primaryUnknown = false;
          },
          refresh: async () => onsaved(),
          refreshAttemptId: 'scheduling.event-type.save.callback',
        }),
      );
      if (actions && actions.scopeVersion !== scopeVersion) return;
      if (outcome.status === 'succeeded') return;
      if (outcome.status === 'committed-refreshing') {
        err = m.asyncAction_refreshing();
        return;
      }
      if (outcome.status === 'partial') {
        err = m.asyncAction_partial();
        return;
      }
      if (outcome.status === 'unknown') {
        if (!tagRepair) primaryUnknown = true;
        err = m.asyncAction_unknown();
        return;
      }
      err = outcome.error instanceof Error ? outcome.error.message : m.data_table_save_failed();
    } catch (e) {
      if (!actions || actions.scopeVersion === scopeVersion)
        err = e instanceof Error ? e.message : 'error';
    } finally {
      if (!actions || actions.scopeVersion === scopeVersion) saving = false;
    }
  }
</script>

<div class="editor">
  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
    <label class="field">
      <span class="t-caption">{m.sched_et_title()}</span>
      <input class="txt" value={f.title} oninput={(e) => onTitle(e.currentTarget.value)} />
    </label>
    <label class="field">
      <span class="t-caption">{m.sched_et_slug()}</span>
      <input class="txt" bind:value={f.slug} oninput={() => (slugTouched = true)} />
    </label>
    <label class="field">
      <span class="t-caption">{m.sched_et_length()}</span>
      <input class="txt" type="number" bind:value={f.length} />
    </label>
    <label class="field">
      <span class="t-caption">{m.sched_et_interval()}</span>
      <input class="txt" type="number" bind:value={f.slotInterval} placeholder={String(f.length)} />
    </label>
    <label class="field">
      <span class="t-caption">{m.sched_et_bufferBefore()}</span>
      <input class="txt" type="number" bind:value={f.beforeBuffer} />
    </label>
    <label class="field">
      <span class="t-caption">{m.sched_et_bufferAfter()}</span>
      <input class="txt" type="number" bind:value={f.afterBuffer} />
    </label>
    <label class="field">
      <span class="t-caption">{m.sched_et_notice()}</span>
      <input class="txt" type="number" bind:value={f.minimumBookingNotice} />
    </label>
    <label class="field">
      <span class="t-caption">{m.sched_et_periodDays()}</span>
      <input class="txt" type="number" bind:value={f.periodDays} />
    </label>
    <label class="field">
      <span class="t-caption">{m.sched_et_schedulingType()}</span>
      <Select
        class="txt"
        value={f.schedulingType ?? ''}
        onchange={(value) => (f.schedulingType = value === '' ? null : String(value))}
      >
        <option value="">{m.sched_et_single()}</option>
        <option value="round_robin">{m.sched_et_roundRobin()}</option>
        <option value="collective">{m.sched_et_collective()}</option>
      </Select>
    </label>
    {#if products.length}
      <div class="field">
        <span class="t-caption">{m.sched_et_product()}</span>
        <ProcedurePickerField {products} bind:value={f.productId} />
      </div>
    {/if}
    {#if kinds.length}
      <label class="field">
        <span class="t-caption">{m.sched_kind_label()}</span>
        <Select
          class="txt"
          value={f.kindId ?? ''}
          onchange={(value) => (f.kindId = value === '' ? null : String(value))}
        >
          {#each kinds as k (k.id)}<option value={k.id}>{k.name}</option>{/each}
        </Select>
      </label>
    {/if}
  </div>

  <div class="field mt-3">
    <span class="t-caption">{m.sched_et_resources()}</span>
    <ResourcePickerField {resources} bind:value={f.resourceIds} />
  </div>

  <div class="field mt-3">
    <span class="t-caption">{m.tags_label()}</span>
    <TagsField scope="catalog" allTags={tags} bind:value={tagIds} disabled={!!tagRepair} />
  </div>

  {#if eventType?.id}
    <div class="field mt-3">
      <div class="flex items-center justify-between gap-2">
        <span class="t-caption">{m.attachments_title()}</span>
        <AttachmentButton
          objectType="event_type"
          objectId={eventType.id}
          size="sm"
          disabled={!canAct('scheduling', 'edit')}
          onuploaded={() => (attachmentsRefreshKey += 1)}
        />
      </div>
      <AttachmentList
        objectType="event_type"
        objectId={eventType.id}
        refreshKey={attachmentsRefreshKey}
        compact
      />
    </div>
  {/if}

  <div class="flex items-center gap-4 mt-3">
    <label class="t-caption flex items-center gap-2">
      <Toggle bind:checked={f.public} size="sm" ariaLabel={m.sched_et_public()} />
      {m.sched_et_public()}
    </label>
    <label class="t-caption flex items-center gap-2">
      <Toggle
        bind:checked={f.requiresConfirmation}
        size="sm"
        ariaLabel={m.sched_et_requiresConfirmation()}
      />
      {m.sched_et_requiresConfirmation()}
    </label>
  </div>

  <!-- Per-service schedule -->
  <div class="mt-3 pt-3 border-t border-[var(--hairline)]">
    <label class="t-caption flex items-center gap-2">
      <Toggle
        bind:checked={f.useCustomSchedule}
        size="sm"
        ariaLabel={m.sched_et_customSchedule()}
      />
      {m.sched_et_customSchedule()}
    </label>
    <p class="t-caption mt-1 opacity-70">{m.sched_et_customSchedule_help()}</p>
    {#if f.useCustomSchedule}
      <div class="mt-2"><WeekHoursEditor bind:week /></div>
    {/if}
  </div>

  {#if err}<p class="t-caption mt-2 save-error" role="alert">{err}</p>{/if}

  <div class="flex gap-2 mt-3">
    <Button onclick={save} disabled={!canSave || saving || primaryUnknown}
      >{tagRepair ? m.asyncAction_retry() : m.sched_save()}</Button
    >
    <Button variant="ghost" onclick={oncancel}>{m.sched_cancel()}</Button>
  </div>
</div>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .txt {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    padding: var(--space-2) var(--space-2);
    background: var(--color-card);
    font-size: var(--font-size-body);
    width: 100%;
  }
  .save-error {
    color: var(--color-danger-fg);
  }
</style>
