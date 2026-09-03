<script lang="ts" module>
  /** A scheduling resource as the event-type editor sees it. */
  export interface SchedulableResource {
    id: string;
    name: string;
    kind?: string;
    email?: string | null;
    active?: boolean;
  }
</script>

<script lang="ts">
  import { ListFilter, X } from 'lucide-svelte';
  import { Badge, Button, Picker, iconSizes, type PickerColumn } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  let {
    resources,
    value = $bindable([]),
  }: {
    resources: SchedulableResource[];
    /** Selected resource ids (the event type's assignable team). */
    value?: string[];
  } = $props();

  // Internal workers only: staff resources that are available. An already-assigned
  // member on vacation still resolves its chip so the form never reads as blank.
  const staff = $derived(
    resources.filter((r) => (r.kind ?? 'staff') === 'staff' && r.active !== false),
  );
  const selected = $derived(value.map((id) => resources.find((r) => r.id === id)).filter(Boolean));
  const pickedIds = $derived(new Set(value));
  let open = $state(false);

  const columns: PickerColumn<SchedulableResource>[] = [
    {
      key: 'name',
      label: m.sched_team_member(),
      priority: 10,
      emphasis: 'primary',
      hideable: false,
      searchable: true,
    },
    {
      key: 'email',
      label: m.party_picker_email(),
      value: (r) => r.email ?? '',
      priority: 20,
      searchable: true,
    },
  ];

  const add = (r: SchedulableResource) => {
    if (!value.includes(r.id)) value = [...value, r.id];
  };
  const remove = (id: string) => {
    value = value.filter((x) => x !== id);
  };
</script>

<div class="team-field">
  <div class="chips">
    {#each selected as r (r!.id)}
      <Badge size="sm">
        {r!.name}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          shape="icon"
          aria-label={m.common_remove()}
          onclick={() => remove(r!.id)}
        >
          <X size={iconSizes.xs} aria-hidden="true" />
        </Button>
      </Badge>
    {/each}
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-haspopup="dialog"
      onclick={() => (open = true)}
    >
      <ListFilter size={iconSizes.sm} aria-hidden="true" />
      {m.sched_et_pick_team()}
    </Button>
  </div>
</div>

<Picker
  bind:open
  title={m.sched_et_pick_team()}
  {columns}
  rows={staff}
  getRowId={(r) => r.id}
  searchText={(r) => `${r.name} ${r.email ?? ''}`}
  onPick={add}
  onUnpick={(r) => remove(r.id)}
  {pickedIds}
  selectionMode="multiple"
  searchPlaceholder={m.sched_et_pick_team()}
  emptyLabel={m.sched_empty_resources()}
  storageKey="sched-team"
/>

<style>
  .team-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }
</style>
