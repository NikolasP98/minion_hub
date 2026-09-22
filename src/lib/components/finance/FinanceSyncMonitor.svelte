<script lang="ts">
  import { untrack } from 'svelte';
  import { financeSync } from '$lib/state/features/finance-sync.svelte';
  import type { ActionRuntime } from '$lib/services/actions/runtime.svelte';

  let { actions, scope, enabled }: { actions: ActionRuntime; scope: string; enabled: boolean } =
    $props();

  const monitorScope = $derived(JSON.stringify([scope, enabled]));

  // Mounted by the persistent root, outside route/module keys. Only a changed
  // principal/org/host identity tears down observation of the durable job.
  $effect(() => {
    const [identity, discover] = JSON.parse(monitorScope) as [string, boolean];
    untrack(() => {
      financeSync.reset();
      if (identity && discover) void financeSync.refresh('susii', actions);
    });
    return () => financeSync.reset();
  });
</script>
