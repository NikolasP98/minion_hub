<script lang="ts">
  import { createAsyncResource, type AsyncResource, type ErrorFormatter } from '../async.svelte';

  type HarnessResource = AsyncResource<string, string[]>;

  let {
    fetcher,
    initialLoading = false,
    formatError,
    onReady,
    onOwnedEffect,
  }: {
    fetcher: (...args: string[]) => Promise<string>;
    initialLoading?: boolean;
    formatError?: ErrorFormatter;
    onReady: (resource: HarnessResource) => void;
    onOwnedEffect: () => void;
  } = $props();

  // Test setup is intentionally captured once, matching component initialization.
  // svelte-ignore state_referenced_locally
  const resource = createAsyncResource(fetcher, { initialLoading, formatError });
  // svelte-ignore state_referenced_locally
  onReady(resource);

  $effect(() => {
    onOwnedEffect();
  });
</script>
