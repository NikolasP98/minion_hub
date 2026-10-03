<script lang="ts">
  import AsyncBoundary from '$lib/components/ui/foundations/AsyncBoundary.svelte';
  import { createTeamRead } from '../latest-read.svelte';
  import { Timeline } from '../timeline.svelte';
  let {
    ready,
    owned,
  }: {
    ready: (value: {
      read: ReturnType<typeof createTeamRead<{ balance: number }>>;
      timeline: Timeline;
    }) => void;
    owned: () => void;
  } = $props();
  const read = createTeamRead<{ balance: number }>();
  const timeline = new Timeline('America/Lima');
  $effect(() => {
    ready({ read, timeline });
    owned();
  });
</script>

<div data-testid="read">
  <AsyncBoundary
    compact
    state={read.loading
      ? { kind: 'loading' }
      : read.error
        ? { kind: 'error', description: read.error, retry: () => void read.retry() }
        : { kind: 'ready' }}
  />
  {#if read.data}<output>{read.data.balance}</output>{/if}
</div>
<div data-testid="timeline">
  <AsyncBoundary
    compact
    state={timeline.loading > 0
      ? { kind: 'loading' }
      : timeline.errors.length
        ? {
            kind: 'error',
            description: timeline.errors.map((range) => range.message).join('; '),
            retry: () => void timeline.retry(),
          }
        : { kind: 'ready' }}
  />
</div>
