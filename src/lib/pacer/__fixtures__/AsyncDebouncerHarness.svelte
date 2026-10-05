<script lang="ts">
  import { createAsyncDebouncer } from '../index.svelte';

  export interface AsyncDebouncerHarnessHandle {
    run(value: string): Promise<unknown>;
    cancel(): void;
    abort(): void;
    flush(): void;
    readonly isPending: boolean;
    readonly isExecuting: boolean;
  }

  let {
    fn,
    wait,
    onReady,
    onOwnedEffect,
  }: {
    fn: (value: string) => Promise<string>;
    wait: number;
    onReady: (debouncer: AsyncDebouncerHarnessHandle) => void;
    onOwnedEffect: () => void;
  } = $props();

  // Test setup is intentionally captured once, matching component initialization.
  // svelte-ignore state_referenced_locally
  const debouncer = createAsyncDebouncer(fn, { wait });
  // svelte-ignore state_referenced_locally
  onReady(debouncer);

  $effect(() => {
    onOwnedEffect();
  });
</script>
