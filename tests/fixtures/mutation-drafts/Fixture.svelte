<script lang="ts">
  import { Button } from '@minion-stack/ui';
  import { onDestroy, type ComponentProps } from 'svelte';
  import Pulse from '../../../src/routes/(app)/pulse/+page.svelte';
  import Scheduling from '../../../src/routes/(app)/scheduling/settings/+page.svelte';
  import BeforePulse from './BeforePulse.svelte';
  import BeforeScheduling from './BeforeScheduling.svelte';
  import { provideActions } from '$lib/services/actions/context';
  import { createActionRuntime } from '$lib/services/actions/runtime.svelte';
  import { transport, installTransport, acknowledge, loseReply } from './state.svelte';
  const query = new URLSearchParams(location.search);
  const before = query.get('version') === 'before';
  const kind = query.get('page') === 'scheduling' ? 'scheduling' : 'pulse';
  const actions = provideActions(createActionRuntime());
  actions.setScope('synthetic-org-a');
  const restoreTransport = installTransport();
  onDestroy(() => actions.dispose());
  onDestroy(restoreTransport);
  const proposal = {
    id: 'proposal-a',
    orgId: 'synthetic-org-a',
    createdAt: new Date('2026-10-03T12:00:00Z'),
    source: 'calendar',
    kind: 'create_event',
    title: 'Quarterly review',
    summary: null,
    payload: { args: { title: 'First draft' } },
    status: 'pending',
    dedupKey: 'synthetic',
    decidedBy: null,
    executedAt: null,
    error: null,
  };
  const pulseData = {
    proposals: [proposal, { ...proposal, id: 'proposal-b', title: 'Team planning' }],
  } as ComponentProps<typeof Pulse>['data'];
  const schedulingData = { kinds: [] } as unknown as ComponentProps<typeof Scheduling>['data'];
</script>

<div class="fixture">
  <aside class="controls">
    <p class="t-label">
      HC-005 / HC-006 · {before ? 'Before' : 'After'} · actual component, synthetic data
    </p>
    <div class="control-row">
      <Button size="touch" disabled={!transport.pending} onclick={acknowledge}
        >Acknowledge save</Button
      >
      <Button size="touch" disabled={!transport.pending} onclick={loseReply}>Lose reply</Button>
      <Button
        size="touch"
        onclick={() => {
          transport.nextReadFails = true;
        }}>Fail next read</Button
      >
      <Button size="touch" onclick={() => actions.setScope('synthetic-org-b')}
        >Switch workspace</Button
      >
    </div>
    <p class="t-caption">
      Writes: {transport.writes} · Reads: {transport.reads} · Pending: {transport.pending
        ? 'yes'
        : 'no'} · Unexpected requests: {transport.unexpectedRequests}
    </p>
  </aside>
  <div class="product">
    {#if kind === 'pulse'}
      {#if before}<BeforePulse data={pulseData} />{:else}<Pulse data={pulseData} />{/if}
    {:else}
      {#if before}<BeforeScheduling data={schedulingData} />{:else}<Scheduling
          data={schedulingData}
        />{/if}
    {/if}
  </div>
</div>

<style>
  .fixture {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--color-canvas);
    color: var(--color-text-primary);
  }
  .controls {
    padding: var(--space-3);
    border-bottom: 1px solid var(--color-border-default);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .control-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .product {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
  }
</style>
