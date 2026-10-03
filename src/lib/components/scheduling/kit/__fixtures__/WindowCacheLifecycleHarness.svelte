<script lang="ts">
  import { onDestroy } from 'svelte';
  import {
    createCalendarWindowCache,
    type CalendarWindowCache,
    type CalendarWindowFetchResult,
  } from '../window-cache.svelte';

  type Week = string[];

  interface Props {
    fetchWindow: (
      from: string,
      to: string,
      signal: AbortSignal,
    ) => Promise<CalendarWindowFetchResult<Week>>;
    expose: (cache: CalendarWindowCache<Week>) => void;
    onError?: (error: unknown, key: string) => void;
  }

  let { fetchWindow, expose, onError }: Props = $props();
  const scope = JSON.stringify(['org-a', 'America/Lima']);
  const cache = createCalendarWindowCache<Week>({
    fetchWindow: (from, to, signal) => fetchWindow(from, to, signal),
    merge: (parts) => parts.flat().sort(),
    onError: (error, key) => onError?.(error, key),
  });
  cache.reconcile({ activeScope: scope, seedScope: scope, seedRange: [], seed: new Map() });
  cache.setVisibleRange('2026-09-21', '2026-09-21', { prefetch: false });
  const exposeCache = () => expose(cache);
  exposeCache();
  onDestroy(cache.dispose);
</script>

<output data-testid="busy">{cache.busy ? 'busy' : 'idle'}</output>
