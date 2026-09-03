<script lang="ts">
  // Rooms & equipment: non-staff `sched_resources` (spec 2026-09-02-hub-team-hr-module-spec §2).
  // They were orphaned when /scheduling/resources became a redirect to /team.
  import type { ComponentProps } from 'svelte';
  import { DoorOpen, Trash2 } from 'lucide-svelte';
  import { invalidate } from '$app/navigation';
  import {
    Button,
    Badge,
    Card,
    EmptyState,
    Input,
    Modal,
    Select,
    Toggle,
    iconSizes,
  } from '$lib/components/ui';
  import type { SelectOption } from '$lib/components/ui';
  import { FormField } from '$lib/components/ui/foundations';
  import AvailabilityEditor from '$lib/components/scheduling/AvailabilityEditor.svelte';
  import * as m from '$lib/paraglide/messages';
  import { jsonMutation, mutationErrorMessage } from '$lib/api/json-mutation';
  import { JSON_HEADERS, type TeamResource } from './types';

  type Schedule = ComponentProps<typeof AvailabilityEditor>['schedule'];

  let {
    resources,
    schedules,
    canEdit,
  }: {
    resources: TeamResource[];
    schedules: Record<string, Schedule>;
    canEdit: boolean;
  } = $props();

  const KIND_LABEL: Record<TeamResource['kind'], () => string> = {
    room: m.team_resource_kind_room,
    equipment: m.team_resource_kind_equipment,
  };
  const kindOptions: SelectOption[] = [
    { value: 'room', label: m.team_resource_kind_room() },
    { value: 'equipment', label: m.team_resource_kind_equipment() },
  ];

  let error = $state<string | null>(null);
  let busy = $state(false);
  let selectedId = $state<string | null>(null);
  const selected = $derived(resources.find((r) => r.id === selectedId) ?? resources[0] ?? null);

  let addOpen = $state(false);
  let addName = $state('');
  let addKind = $state<string>('room');
  let addColor = $state('');

  async function mutate(input: string, body: Record<string, unknown>, method = 'PATCH') {
    error = null;
    busy = true;
    try {
      await jsonMutation({
        input,
        init: { method, headers: JSON_HEADERS, body: JSON.stringify(body) },
        onSuccess: () => invalidate('team:data'),
      });
      return true;
    } catch (e) {
      error = mutationErrorMessage(e, m.common_error());
      return false;
    } finally {
      busy = false;
    }
  }
  async function add() {
    if (!addName.trim()) return;
    const ok = await mutate(
      '/api/scheduling/resources',
      { name: addName.trim(), kind: addKind, color: addColor || null },
      'POST',
    );
    if (ok) {
      addOpen = false;
      addName = '';
    }
  }
  const toggleActive = (r: TeamResource) =>
    mutate(`/api/scheduling/resources/${r.id}`, { active: !r.active });
  // PATCH { deleted } so removal rides on scheduling:edit (DELETE needs scheduling:delete).
  async function remove(r: TeamResource) {
    if (await mutate(`/api/scheduling/resources/${r.id}`, { deleted: true })) selectedId = null;
  }
</script>

{#if error}
  <p class="hr-alert" role="alert">{error}</p>
{/if}

<div class="resources">
  <Card padding="sm" class="list">
    <div class="list-head">
      <span class="t-label">{m.team_tab_resources()}</span>
      <Button variant="outline" size="sm" onclick={() => (addOpen = true)} disabled={!canEdit}>
        + {m.common_add()}
      </Button>
    </div>
    {#if resources.length === 0}
      <EmptyState compact icon={DoorOpen} title={m.team_resources_empty()} />
    {:else}
      <ul class="items" role="listbox" aria-label={m.team_tab_resources()}>
        {#each resources as r (r.id)}
          <li>
            <Button
              variant="ghost"
              size="sm"
              class="item"
              aria-current={selected?.id === r.id ? 'true' : undefined}
              onclick={() => (selectedId = r.id)}
            >
              <span class="swatch" style:--c={r.color ?? 'var(--color-accent)'} aria-hidden="true"
              ></span>
              <span class="truncate">{r.name}</span>
              <Badge size="sm">{KIND_LABEL[r.kind]()}</Badge>
              {#if !r.active}
                <Badge variant="semantic" value="warning" size="sm">{m.team_status_left()}</Badge>
              {/if}
            </Button>
          </li>
        {/each}
      </ul>
    {/if}
  </Card>
  <Card padding="md" class="editor">
    {#if selected}
      <div class="editor-head">
        <div class="t-label flex items-center gap-1.5">
          <DoorOpen size={iconSizes.sm} class="text-accent" aria-hidden="true" />
          {selected.name}
          <Badge size="sm">{KIND_LABEL[selected.kind]()}</Badge>
        </div>
        <div class="editor-actions">
          <Toggle
            size="sm"
            checked={selected.active}
            label={m.team_status_active()}
            disabled={busy || !canEdit}
            onchange={() => toggleActive(selected)}
          />
          <Button
            variant="ghost"
            size="xs"
            shape="icon"
            aria-label={m.common_delete()}
            disabled={busy || !canEdit}
            onclick={() => remove(selected)}
          >
            <Trash2 size={iconSizes.sm} aria-hidden="true" />
          </Button>
        </div>
      </div>
      {#key selected.id}
        <AvailabilityEditor resourceId={selected.id} schedule={schedules[selected.id] ?? null} />
      {/key}
    {:else}
      <EmptyState icon={DoorOpen} title={m.team_resources_empty()} />
    {/if}
  </Card>
</div>

<Modal bind:open={addOpen} title={m.team_resource_add()} size="sm">
  <div class="hr-form">
    <FormField label={m.team_resource_name()} required>
      {#snippet children(control)}
        <Input {...control} bind:value={addName} />
      {/snippet}
    </FormField>
    <Select label={m.team_resource_kind()} options={kindOptions} bind:value={addKind} />
    <FormField label={m.team_resource_color()}>
      {#snippet children(control)}
        <input {...control} class="hr-date" type="color" bind:value={addColor} />
      {/snippet}
    </FormField>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => (addOpen = false)}>{m.common_cancel()}</Button>
    <Button onclick={add} disabled={busy || !addName.trim()}>{m.common_add()}</Button>
  {/snippet}
</Modal>

<style>
  .resources {
    display: grid;
    gap: var(--space-4);
    align-items: start;
  }
  @media (min-width: 1024px) {
    .resources {
      grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
    }
  }
  .list-head,
  .editor-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .editor-actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .items {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* List-selection contract: accent-tinted row + accent text, never a full fill. */
  .items :global(.item) {
    width: 100%;
    justify-content: flex-start;
  }
  .items :global(.item[aria-current='true']) {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    color: var(--color-accent);
  }
  .swatch {
    width: var(--space-2);
    height: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--c);
    flex-shrink: 0;
  }
</style>
