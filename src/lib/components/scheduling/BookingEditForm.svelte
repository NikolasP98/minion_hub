<script lang="ts">
  /**
   * Full-CRUD edit for an existing booking (spec S5) — mounted at
   * `/scheduling/bookings/[id]/edit`. Markup/classes mirror BookingCreateForm
   * so the two forms read as one family; this one never touches start/end
   * (drag/resize on the calendar owns that) and adds a delete flow.
   */
  import { Button, Select } from '$lib/components/ui';
  import { ConfirmDialog } from '$lib/components/ui/foundations';
  import { goto } from '$lib/navigation';
  import * as m from '$lib/paraglide/messages';
  import CustomerPicker from '$lib/components/pos/CustomerPicker.svelte';
  import ServicePickerField from '$lib/components/scheduling/ServicePickerField.svelte';
  import ResourcePickerField, {
    type SchedulableResource,
  } from '$lib/components/scheduling/ResourcePickerField.svelte';
  import TagsField from '$lib/components/tags/TagsField.svelte';
  import type { CalKind, CalTag } from '$lib/components/scheduling/calendar/types';
  import { canAct } from '$lib/access/can.svelte';

  export type EditableBooking = {
    id: string;
    title: string | null;
    notes: string | null;
    status: string;
    eventTypeId: string;
    productId: string | null;
    resourceId: string;
    kindId: string | null;
    crmContactId: string | null;
    partyId: string | null;
    attendeeName: string | null;
    attendeeEmail: string | null;
    attendeePhone: string | null;
  };
  export type EditableEventType = {
    id: string;
    title: string;
    productId: string | null;
    active?: boolean;
    length?: number;
    kindId: string | null;
  };

  let {
    booking,
    eventTypes,
    resources,
    kinds = [],
    tags = [],
    currentTagIds = [],
    returnTo = '/scheduling/bookings',
    onsaved,
    ondeleted,
  }: {
    booking: EditableBooking;
    eventTypes: EditableEventType[];
    resources: SchedulableResource[];
    kinds?: CalKind[];
    tags?: CalTag[];
    currentTagIds?: string[];
    returnTo?: string;
    onsaved?: (booking: unknown) => void;
    ondeleted?: () => void;
  } = $props();

  // The loaded booking is a one-time seed for this edit session (the page
  // load re-runs on navigation, not on a prop change), same pattern
  // BookingCreateForm uses for its own `?date=`/`?resource=` deep-link seeds.
  // svelte-ignore state_referenced_locally
  let title = $state(booking.title ?? '');
  // svelte-ignore state_referenced_locally
  let notes = $state(booking.notes ?? '');
  // svelte-ignore state_referenced_locally
  let eventTypeId = $state(booking.eventTypeId);
  // svelte-ignore state_referenced_locally
  let kindId = $state(booking.kindId ?? kinds.find((k) => k.isDefault)?.id ?? '');
  // svelte-ignore state_referenced_locally
  let tagIds = $state<string[]>([...currentTagIds]);

  // svelte-ignore state_referenced_locally
  let partyId = $state<string | null>(booking.partyId ?? null);
  // svelte-ignore state_referenced_locally
  let customerName = $state<string | null>(booking.attendeeName ?? null);
  // svelte-ignore state_referenced_locally
  let phone = $state<string | null>(booking.attendeePhone ?? null);
  // svelte-ignore state_referenced_locally
  let attendeeEmail = $state(booking.attendeeEmail ?? '');
  // The CRM link only survives while the customer picker still points at the
  // booking's original contact — pick a different party/name and the edit
  // just clears the link rather than guessing a new one (createBooking's
  // resolve/create-on-save magic is a create-time feature, not an edit one).
  // svelte-ignore state_referenced_locally
  const initialPartyId = booking.partyId ?? null;
  // svelte-ignore state_referenced_locally
  const initialCustomerName = booking.attendeeName ?? null;

  // ResourcePickerField is multi-select (its only other caller assigns a
  // team); a booking has exactly one resource, so keep the array capped at 1.
  // svelte-ignore state_referenced_locally
  let resourceIds = $state<string[]>([booking.resourceId]);
  $effect(() => {
    if (resourceIds.length > 1) resourceIds = [resourceIds[resourceIds.length - 1]];
  });

  let saving = $state(false);
  let err = $state<string | null>(null);

  async function save() {
    if (!eventTypeId || !customerName?.trim() || !resourceIds[0]) {
      err = 'service, client and staff required';
      return;
    }
    saving = true;
    err = null;
    try {
      const crmContactId =
        partyId === initialPartyId && customerName === initialCustomerName
          ? (booking.crmContactId ?? null)
          : null;
      const res = await fetch(`/api/scheduling/bookings/${booking.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: title.trim() || null,
          notes: notes.trim() || null,
          eventTypeId,
          resourceId: resourceIds[0],
          kindId: kindId || null,
          crmContactId,
          partyId,
          attendeeName: customerName,
          attendeeEmail: attendeeEmail.trim() || null,
          attendeePhone: phone || null,
        }),
      });
      if (res.status === 409) {
        const j = await res.json().catch(() => ({}));
        err = j?.message ?? m.sched_book_unavailable();
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      await fetch(`/api/tags/booking/${booking.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tagIds }),
      });
      const { booking: saved } = (await res.json()) as { booking: unknown };
      onsaved?.(saved);
      await goto(returnTo);
    } catch (e) {
      err = e instanceof Error ? e.message : 'error';
    } finally {
      saving = false;
    }
  }

  // ── Delete ──
  let deleteOpen = $state(false);
  let referencedReasons = $state<string[] | null>(null);
  const REASON_LABEL: Record<string, () => string> = {
    ticket: m.sched_reference_ticket,
    order: m.sched_reference_order,
    accrual: m.sched_reference_accrual,
  };
  const failureMessage = $derived(
    referencedReasons?.length
      ? m.sched_delete_referenced({
          reasons: referencedReasons.map((r) => (REASON_LABEL[r] ?? (() => r))()).join(', '),
        })
      : m.sched_book_unavailable(),
  );

  async function confirmDelete() {
    referencedReasons = null;
    const res = await fetch(`/api/scheduling/bookings/${booking.id}`, { method: 'DELETE' });
    if (res.status === 409) {
      const j = await res.json().catch(() => ({ references: [] }));
      referencedReasons = j.references ?? [];
      throw new Error('referenced');
    }
    if (!res.ok) throw new Error(String(res.status));
    ondeleted?.();
    await goto(returnTo);
  }

  async function cancelInstead() {
    await fetch(`/api/scheduling/bookings/${booking.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' }),
    });
    deleteOpen = false;
    ondeleted?.();
    await goto(returnTo);
  }

  const canEdit = $derived(canAct('scheduling', 'edit'));
</script>

<div class="booking-form">
  <label class="field">
    <span class="t-caption">{m.sched_edit_title_label()}</span>
    <input class="txt" type="text" bind:value={title} />
  </label>
  <label class="field">
    <span class="t-caption">{m.sched_edit_notes_label()}</span>
    <textarea class="txt" rows="3" bind:value={notes}></textarea>
  </label>
  <div class="field">
    <span class="t-caption">{m.sched_book_choose_service()}</span>
    <ServicePickerField services={eventTypes} bind:value={eventTypeId} />
  </div>
  <div class="field">
    <span class="t-caption">{m.sched_team_member()}</span>
    <ResourcePickerField {resources} bind:value={resourceIds} />
  </div>
  {#if kinds.length > 0}
    <label class="field">
      <span class="t-caption">{m.sched_kind_label()}</span>
      <Select value={kindId} onchange={(v) => (kindId = String(v))}>
        {#each kinds as k (k.id)}<option value={k.id}>{k.name}</option>{/each}
      </Select>
    </label>
  {/if}
  <CustomerPicker
    bind:partyId
    bind:customerName
    bind:phone
    required
    label={m.sched_book_find_client()}
  />
  <label class="field">
    <span class="t-caption">{m.sched_edit_attendee_email()}</span>
    <input class="txt" type="email" bind:value={attendeeEmail} />
  </label>
  <div class="field">
    <span class="t-caption">{m.tags_label()}</span>
    <TagsField allTags={tags} bind:value={tagIds} />
  </div>
  {#if err}<p class="t-caption danger">{err}</p>{/if}
  <div class="actions">
    <Button
      onclick={save}
      disabled={saving || !canEdit}
      title={canEdit ? undefined : m.no_permission()}>{m.common_save()}</Button
    >
    <Button variant="ghost" href={returnTo}>{m.sched_cancel()}</Button>
    <Button
      variant="danger"
      type="button"
      disabled={!canEdit}
      title={canEdit ? undefined : m.no_permission()}
      onclick={() => (deleteOpen = true)}>{m.common_delete()}</Button
    >
  </div>
</div>

<ConfirmDialog
  bind:open={deleteOpen}
  title={m.sched_delete_confirm_title()}
  message={m.sched_delete_confirm_body()}
  tone="danger"
  confirmLabel={m.common_delete()}
  {failureMessage}
  onconfirm={confirmDelete}
>
  {#snippet details()}
    {#if referencedReasons?.length}
      <Button variant="outline" size="sm" type="button" onclick={cancelInstead}>
        {m.sched_delete_cancel_instead()}
      </Button>
    {/if}
  {/snippet}
</ConfirmDialog>

<style>
  .booking-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-width: 40rem;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .txt {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-2);
    background: var(--color-surface-1);
    color: var(--color-text-primary);
    font-size: var(--font-size-body);
    width: 100%;
    font-family: inherit;
  }
  .danger {
    color: var(--color-danger-fg);
  }
  .actions {
    display: flex;
    gap: var(--space-2);
  }
</style>
