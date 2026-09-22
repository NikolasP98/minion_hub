<script lang="ts">
  import FinanceSyncMonitor from '../FinanceSyncMonitor.svelte';
  import type { ActionRuntime } from '$lib/services/actions/runtime.svelte';
  let { actions, scope, module }: { actions: ActionRuntime; scope: string; module: string } =
    $props();
</script>

<FinanceSyncMonitor {actions} {scope} enabled={true} />
{#key module}<p>{module}</p>{/key}
