<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Button } from '$lib/components/ui';
  import PluginHealthPanel from '$lib/components/reliability/PluginHealthPanel.svelte';
  import InsightsPanel from '$lib/components/reliability/InsightsPanel.svelte';
  import ArchitectureGraph from '$lib/components/reliability/architecture/ArchitectureGraph.svelte';
  import {
    publishGatewaySessionOwner,
    retireGatewaySessionOwner,
  } from '$lib/services/gateway/session-owner.svelte';
  import { pluginSnapshot, insightsSnapshot, architectureSnapshot } from './responses';

  let panel = $state('plugins');
  let failReads = $state(true);
  let orgId = $state('synthetic-org-a');
  let requests = $state(0);
  const actorId = 'synthetic-actor';
  const serverId = 'synthetic-gateway';
  const hostUrl = 'wss://example.invalid';
  const to = Date.now();
  const from = to - 86_400_000;
  const originalFetch = globalThis.fetch;
  const label = () => (orgId.endsWith('-a') ? 'Workspace A' : 'Workspace B');
  const delay = () => new Promise<void>((resolve) => setTimeout(resolve, 120));

  function publishOwner() {
    const capturedOrg = orgId;
    publishGatewaySessionOwner({
      actorId,
      orgId: capturedOrg,
      hostId: serverId,
      hostUrl,
      methods: ['reliability.plugins'],
      current: () => capturedOrg === orgId,
      request: async () => {
        requests++;
        const fail = failReads;
        const capturedLabel = label();
        await delay();
        if (fail) throw new Error('Synthetic unavailable transport');
        return pluginSnapshot(from, to, capturedLabel);
      },
    });
  }
  publishOwner();
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), location.origin);
    if (!['/api/reliability/insights', '/api/reliability/architecture'].includes(url.pathname)) {
      throw new Error('Unexpected fixture transport');
    }
    // Fetch is an external transport boundary. Fixture controls must not become
    // dependencies of the production effect that invokes a request synchronously.
    const { fail, capturedLabel, total } = untrack(() => {
      requests++;
      return { fail: failReads, capturedLabel: label(), total: orgId.endsWith('-a') ? 42 : 7 };
    });
    await delay();
    if (fail) return new Response('{"error":"Synthetic unavailable"}', { status: 503 });
    const body = url.pathname.endsWith('/insights')
      ? insightsSnapshot(
          Number(url.searchParams.get('from')),
          Number(url.searchParams.get('to')),
          total,
        )
      : architectureSnapshot(capturedLabel);
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  function changeOwner() {
    orgId = orgId.endsWith('-a') ? 'synthetic-org-b' : 'synthetic-org-a';
    publishOwner();
  }
  onDestroy(() => {
    globalThis.fetch = originalFetch;
    retireGatewaySessionOwner();
  });
</script>

<main>
  <header>
    <p class="eyebrow">Actual panel evidence · synthetic transport</p>
    <h1>Reliability panels</h1>
    <p>
      Production panels, loaders, shared controls and graph renderer. Local synthetic data; no
      authenticated production session or provider request.
    </p>
    <div class="controls" aria-label="Fixture controls">
      <Button onclick={() => (failReads = !failReads)}
        >{failReads ? 'Allow reads' : 'Fail reads'}</Button
      >
      <Button variant="secondary" onclick={changeOwner}>Switch workspace</Button>
      <span aria-live="polite"
        >{label()} · {requests} reads · {failReads
          ? 'transport fails'
          : 'transport available'}</span
      >
    </div>
    <nav class="controls" aria-label="Fixture panel selection">
      {#each ['plugins', 'insights', 'architecture'] as name}
        <Button variant={panel === name ? 'primary' : 'ghost'} onclick={() => (panel = name)}
          >{name}</Button
        >
      {/each}
    </nav>
  </header>
  <section class:architecture={panel === 'architecture'} aria-label="Actual production panel">
    {#if panel === 'plugins'}
      <PluginHealthPanel {serverId} {actorId} {orgId} {hostUrl} {from} {to} />
    {:else if panel === 'insights'}
      <InsightsPanel {serverId} {actorId} {orgId} {from} {to} />
    {:else}
      <ArchitectureGraph {actorId} {orgId} />
    {/if}
  </section>
</main>

<style>
  main {
    min-height: 100dvh;
    max-width: 80rem;
    margin-inline: auto;
    padding: var(--space-4);
    color: var(--color-text-primary);
  }
  header {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
  h1 {
    font-size: var(--font-size-heading);
    font-weight: var(--font-weight-semibold);
  }
  p,
  .controls span {
    color: var(--color-text-secondary);
  }
  .eyebrow {
    font-size: var(--font-size-caption);
    color: var(--color-accent);
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
  }
  section {
    min-width: 0;
  }
  .architecture {
    height: 46rem;
  }
  @media (max-width: 767.98px), (pointer: coarse) {
    .controls :global(button) {
      min-height: var(--control-height-touch);
    }
    .controls span {
      width: 100%;
    }
  }
</style>
