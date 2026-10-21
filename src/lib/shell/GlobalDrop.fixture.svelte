<script lang="ts">
  import { provideDropRegistry } from './drop-context.svelte';
  import GlobalDropTarget from '$lib/components/layout/GlobalDropTarget.svelte';
  let { receive }: { receive: (files: File[], signal: AbortSignal) => Promise<void> } = $props();
  const registry = provideDropRegistry();
  registry.register({
    id: 'target',
    label: 'Target record',
    available: () => true,
    receive: (files, signal) => receive(files, signal),
  });
</script>

<GlobalDropTarget />
