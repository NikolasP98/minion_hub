<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import { Clock } from 'lucide-svelte';
  import { Button, Card, EmptyState, iconSizes } from '$lib/components/ui';
  import AvailabilityEditor from '$lib/components/scheduling/AvailabilityEditor.svelte';
  import * as m from '$lib/paraglide/messages';
  import type { TeamEmployee } from './types';

  type Schedule = ComponentProps<typeof AvailabilityEditor>['schedule'];

  let {
    employees,
    schedules,
  }: {
    employees: TeamEmployee[];
    schedules: Record<string, Schedule>;
  } = $props();

  const active = $derived(employees.filter((e) => e.status === 'active'));
  let selectedId = $state<string | null>(null);
  const selected = $derived(active.find((e) => e.id === selectedId) ?? active[0] ?? null);
</script>

{#if active.length === 0}
  <EmptyState title={m.team_roster_empty()} />
{:else}
  <div class="availability">
    <Card padding="sm" class="list">
      <ul class="people" role="listbox" aria-label={m.team_tab_availability()}>
        {#each active as e (e.id)}
          <li>
            <Button
              variant="ghost"
              size="sm"
              class="person"
              aria-current={selected?.id === e.id ? 'true' : undefined}
              onclick={() => (selectedId = e.id)}
            >
              <span class="truncate">{e.name}</span>
            </Button>
          </li>
        {/each}
      </ul>
    </Card>
    <Card padding="md" class="editor">
      {#if selected?.resourceId}
        <div class="t-label mb-2 flex items-center gap-1.5">
          <Clock size={iconSizes.sm} class="text-accent" aria-hidden="true" />
          {selected.name}
        </div>
        {#key selected.resourceId}
          <AvailabilityEditor
            resourceId={selected.resourceId}
            schedule={schedules[selected.resourceId] ?? null}
          />
        {/key}
      {:else if selected}
        <EmptyState title={m.team_availability_no_resource()} />
      {:else}
        <EmptyState title={m.team_availability_pick()} />
      {/if}
    </Card>
  </div>
{/if}

<style>
  .availability {
    display: grid;
    gap: var(--space-4);
    align-items: start;
  }
  @media (min-width: 1024px) {
    .availability {
      grid-template-columns: minmax(200px, 260px) minmax(0, 1fr);
    }
  }
  .people {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  /* List-selection contract: accent-tinted row + accent text, never a full fill. */
  .people :global(.person) {
    width: 100%;
    justify-content: flex-start;
  }
  .people :global(.person[aria-current='true']) {
    background: color-mix(in srgb, var(--color-accent) 10%, transparent);
    color: var(--color-accent);
  }
</style>
