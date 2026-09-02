<script lang="ts" module>
  /** A schedule-enabled catalog service (an event type) as the booking forms see it. */
  export interface SchedulableService {
    id: string;
    title: string;
    length?: number;
    active?: boolean;
  }
</script>

<script lang="ts">
  import { ListFilter, X } from 'lucide-svelte';
  import { Button, Picker, iconSizes, type PickerColumn } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  let {
    services,
    value = $bindable(''),
    onchange,
  }: {
    services: SchedulableService[];
    /** Selected event type id; '' when nothing is picked. */
    value?: string;
    onchange?: (id: string) => void;
  } = $props();

  // Dormant (inactive) services never show in the picker; an already-selected
  // one still resolves its label so an open form never reads as blank.
  const enabled = $derived(services.filter((s) => s.active !== false));
  const selected = $derived(services.find((s) => s.id === value) ?? null);
  let open = $state(false);

  const columns: PickerColumn<SchedulableService>[] = [
    {
      key: 'title',
      label: m.sched_booking_service(),
      priority: 10,
      emphasis: 'primary',
      hideable: false,
      searchable: true,
    },
    {
      key: 'length',
      label: m.sched_et_length(),
      value: (s) => (s.length ? `${s.length} min` : ''),
      align: 'right',
      priority: 20,
    },
  ];

  function pick(s: SchedulableService) {
    value = s.id;
    onchange?.(s.id);
  }
  function clear() {
    value = '';
    onchange?.('');
  }
</script>

<div class="service-field">
  <Button
    type="button"
    variant="outline"
    size="sm"
    class="service-trigger"
    aria-haspopup="dialog"
    onclick={() => (open = true)}
  >
    <span class="service-label" class:is-placeholder={!selected}>
      {selected?.title ?? m.sched_book_choose_service()}
    </span>
    <ListFilter size={iconSizes.sm} aria-hidden="true" />
  </Button>
  {#if selected}
    <Button
      type="button"
      variant="ghost"
      size="xs"
      shape="icon"
      aria-label={m.common_reset()}
      onclick={clear}
    >
      <X size={iconSizes.sm} aria-hidden="true" />
    </Button>
  {/if}
</div>

<Picker
  bind:open
  title={m.sched_book_choose_service()}
  {columns}
  rows={enabled}
  getRowId={(s) => s.id}
  searchText={(s) => s.title}
  onPick={pick}
  selectionMode="single"
  searchPlaceholder={m.sched_book_choose_service()}
  emptyLabel={m.sched_empty_eventTypes()}
  storageKey="sched-service"
/>

<style>
  .service-field {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .service-field :global(.service-trigger) {
    flex: 1;
    min-width: 0;
  }
  .service-field :global(.service-trigger > span) {
    width: 100%;
    justify-content: space-between;
  }
  .service-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .is-placeholder {
    color: var(--color-text-tertiary);
  }
</style>
