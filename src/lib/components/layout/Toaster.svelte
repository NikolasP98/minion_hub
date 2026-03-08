<script lang="ts">
  import * as toast from '@zag-js/toast';
  import { normalizeProps, useMachine } from '@zag-js/svelte';
  import { toaster } from '$lib/state/ui/toast.svelte';
  import ToastItem from './ToastItem.svelte';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = useMachine(toast.group.machine as any, () => ({
    id: 'toaster',
    store: toaster,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = $derived(toast.group.connect(service as any, normalizeProps));
</script>

<div {...api.getGroupProps() as Record<string, unknown>} class="toast-group">
  {#each api.getToasts() as t, index (t.id)}
    <ToastItem toast={t} {index} parent={service as any} />
  {/each}
</div>

<style>
  .toast-group {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 8px;
    pointer-events: none;
  }
</style>
