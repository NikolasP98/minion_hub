<script lang="ts">
  import { AsyncBoundary, type AsyncBoundaryState } from '$lib/components/ui/foundations';
  import * as m from '$lib/paraglide/messages';
  import type { createReliabilityCoordinator } from '$lib/state/reliability/coordinator.svelte';
  import type { ReliabilityReadStatus } from '$lib/state/reliability/owned-resource.svelte';
  let { states, persistenceUnavailable = false, coordinator }: {
    states: Record<string, ReliabilityReadStatus>;
    persistenceUnavailable?: boolean;
    coordinator: Pick<ReturnType<typeof createReliabilityCoordinator>, 'refresh'>;
  } = $props();
  // Resource recovery belongs to these reads, regardless of the active page tab.
  function retry() { void coordinator.refresh(); }
  const labels = $derived<Record<string, string>>({
    summary: m.reliability_resourceSummary(), summaryAll: m.reliability_resourceFacets(),
    events: m.reliability_resourceEvents(), timeline: m.reliability_resourceTimeline(),
    flow: m.reliability_resourceFlow(), usage: m.reliability_resourceUsage(),
    activity: m.reliability_resourceActivity(), perf: m.reliability_resourcePerformance(),
  });
  const notices = $derived(Object.entries(states).filter(([, status]) =>
    status === 'failed' || status === 'unavailable' || status === 'unsupported'));
  function state(name: string, status: ReliabilityReadStatus): AsyncBoundaryState {
    return status === 'failed'
      ? { kind: 'error', title: m.reliability_resourceFailed({ resource: labels[name] ?? name }), description: m.reliability_lastSuccessful(), retry }
      : { kind: 'unavailable', title: m.reliability_resourceUnavailable({ resource: labels[name] ?? name }),
        description: status === 'unsupported' ? m.reliability_sampleOnly() : m.reliability_readUnavailable(),
        ...(status === 'unsupported' ? {} : { retry }) };
  }
</script>

{#if persistenceUnavailable}
  <p class="persistence-notice" role="status">{m.reliability_filtersNotSaved()}</p>
{/if}
{#if notices.length}
  <div class="read-notices">
    {#each notices as [name, status] (name)}
      <AsyncBoundary state={state(name, status)} compact />
    {/each}
  </div>
{/if}

<style>
  .read-notices {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
    gap: var(--space-2);
    margin-bottom: var(--space-3);
    min-width: 0;
  }
  .persistence-notice {
    padding: var(--space-3);
    color: var(--color-warning-fg);
    background: var(--color-warning-surface);
    border: 1px solid var(--color-warning-border);
    border-radius: var(--radius-md);
  }
  @media (max-width: 767.98px), (pointer: coarse) {
    .read-notices :global(button) {
      min-height: var(--control-height-touch);
      min-width: var(--control-height-touch);
    }
  }
</style>
