<script lang="ts">
  import * as toast from '@zag-js/toast';
  import { normalizeProps, useMachine } from '@zag-js/svelte';
  import { toaster } from '$lib/state/ui/toast.svelte';
  import ToastItem from './ToastItem.svelte';
  import * as m from '$lib/paraglide/messages';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = useMachine(toast.group.machine as any, () => ({
    id: 'toaster',
    store: toaster,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = $derived(toast.group.connect(service as any, normalizeProps));
</script>

<!-- Not a live region: toasts are spoken by the shared announcer (see toast.svelte.ts), which
     also covers the ones fired before this deferred component mounts. -->
<div
  {...api.getGroupProps() as Record<string, unknown>}
  class="toast-group"
  aria-live="off"
  aria-label={m.notif_title()}
>
  {#each api.getToasts() as t, index (t.id)}
    <ToastItem toast={t} {index} parent={service as any} />
  {/each}
</div>

<style>
  .toast-group {
    /* Zag sets position, top/right, display, flex-direction, and z-index via inline styles.
       We only need to constrain the width so absolute children have a positioning context. */
    width: 380px;
    pointer-events: none;
  }
</style>
