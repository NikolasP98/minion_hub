<script lang="ts">
  import { page } from '$app/state';
  import { checkedRefresh } from '$lib/services/actions/refresh';
  import { invalidateAll } from '$app/navigation';
  import JoinPendingState from '$lib/components/join/JoinPendingState.svelte';
  import * as m from '$lib/paraglide/messages';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{m.join_pendingEyebrow()} — Minion Hub</title></svelte:head>
<JoinPendingState
  pending={data.pending}
  onrefresh={() => checkedRefresh(invalidateAll, () => page)}
/>
