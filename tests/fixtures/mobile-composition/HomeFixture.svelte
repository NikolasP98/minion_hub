<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import Shell from './Shell.svelte';
  // Mounts the ACTUAL Home route component with a synthetic identity. The
  // gateway stays disconnected, so the feed/chat render their offline states —
  // the composer, call controls and notes dock are still fully composed.
  import HomePage from '../../../src/routes/(app)/home/+page.svelte';
  import { conn } from '$lib/state/gateway';

  // Synthetic "gateway up" so the call/history controls render enabled and can
  // be exercised with the keyboard. No socket is opened; feed/chat RPCs simply
  // never resolve and their offline/error states render.
  conn.connected = true;
  conn.closed = false;

  // The route's PageData also carries the whole (app) layout bundle; this
  // fixture only needs the page's own slice.
  const data = {
    userName: 'Fixture User',
    greeting: 'Good to see you, Fixture.',
    openedIds: [] as string[],
  } as unknown as ComponentProps<typeof HomePage>['data'];
</script>

<Shell>
  <HomePage {data} />
</Shell>
