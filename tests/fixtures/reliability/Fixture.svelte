<script lang="ts">
  import { Button } from '$lib/components/ui';
  import { reliabilityReply } from '$lib/state/reliability/__fixtures__/responses';
  import { onMount } from 'svelte';
  import { createReliabilityCoordinator } from '$lib/state/reliability/coordinator.svelte';
  import { reliability } from '$lib/state/reliability/reliability.svelte';
  import { publishGatewaySessionOwner } from '$lib/services/gateway/session-owner.svelte';
  import ReliabilityReadNotices from '$lib/components/reliability/ReliabilityReadNotices.svelte';
  let ready = $state(false);
  let failReads = 0;
  let requests = $state(0);
  const methods = ['summary', 'events', 'timeline', 'flow', 'usage', 'activity', 'perf'].map((name) => `reliability.${name}`);
  const owner = publishGatewaySessionOwner({
    actorId: 'synthetic-user', orgId: 'synthetic-org', hostId: 'synthetic-gateway', hostUrl: 'wss://example.invalid',
    methods, current: () => true, request: async (method) => {
      requests++;
      const fail = failReads > 0;
      if (fail) failReads--;
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (fail) throw new Error('Synthetic unavailable transport');
      return reliabilityReply(method, 42);
    },
  });
  const coordinator = createReliabilityCoordinator({ ready: () => ready, owner: () => owner, query: () => ({ from: 1, to: 100 }) });
  onMount(() => { ready = true; });
  function simulateFailure() { failReads = 8; void coordinator.refresh(); }
  function recover() { failReads = 0; void coordinator.refresh(); }
</script>
<main>
  <p class="eyebrow">Actual component evidence · synthetic gateway</p>
  <h1>Reliability refresh recovery</h1>
  <p>Production request coordinator, state loaders, error notices and shared controls. This is a local component fixture, not a logged-in production session.</p>
  <div class="controls">
    <Button onclick={simulateFailure}>Simulate failed refresh</Button>
    <Button onclick={recover}>Restore connection</Button>
  </div>
  <div class="snapshot" aria-live="polite">
    <span>Last successful event count</span>
    <strong>{reliability.summary?.total ?? '—'}</strong>
    <span>{reliability.states.summary} · {requests} RPC reads</span>
  </div>
  <ReliabilityReadNotices states={reliability.states} persistenceUnavailable {coordinator} />
</main>
<style>
  main { height: 100dvh; overflow-y: auto; max-width: 72rem; margin-inline: auto; padding: var(--space-4); display: flex; flex-direction: column; gap: var(--space-4); color: var(--color-text-primary); }
  h1 { font-size: var(--font-size-heading); font-weight: var(--font-weight-semibold); }
  p { color: var(--color-text-secondary); }
  .eyebrow { font-size: var(--font-size-caption); color: var(--color-accent); }
  .controls { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .snapshot { display: flex; flex-wrap: wrap; gap: var(--space-4); align-items: center; padding: var(--space-4); background: var(--color-surface-2); border: 1px solid var(--color-border-default); border-radius: var(--radius-lg); }
  strong { font-size: var(--font-size-heading); }
  @media (max-width: 767.98px), (pointer: coarse) {
    .controls :global(button) { min-height: var(--control-height-touch); }
  }
</style>
