<script lang="ts">
  import Before from './Before.svelte';
  import JoinPendingState from '$lib/components/join/JoinPendingState.svelte';
  import type { OwnPendingRequests } from '$server/services/join/pending.repository';
  const params = new URLSearchParams(location.search);
  const before = params.get('version') === 'before';
  const count = Math.min(50, Math.max(0, Number(params.get('count') ?? 0)));
  const pending: OwnPendingRequests = {
    kind: count === 0 ? 'none' : count === 1 ? 'one' : 'many',
    requests: Array.from({ length: count }, (_, i) => ({
      id: `synthetic-${i}`,
      organizationName:
        i === 1 ? 'Research workspace — ' + 'long'.repeat(24) : `Example workspace ${i + 1}`,
      createdAt: '2026-10-03T10:00:00Z',
    })),
    hasMore: count === 50,
  };
  let attempts = 0;
  async function refresh() {
    attempts++;
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (attempts === 1) throw new Error('Synthetic read failure');
  }
</script>

{#if before}<Before />{:else}<JoinPendingState {pending} onrefresh={refresh} />{/if}
