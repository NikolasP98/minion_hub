<script lang="ts">
  import { createDebouncer } from '../index.svelte';

  export interface DebouncerHarnessHandle {
    run(value: string): unknown;
    cancel(): void;
    flush(): void;
    readonly isPending: boolean;
  }

  let {
    fn,
    wait,
    onReady,
    onOwnedEffect,
  }: {
    fn: (value: string) => void;
    wait: number;
    onReady: (debouncer: DebouncerHarnessHandle) => void;
    onOwnedEffect: () => void;
  } = $props();

  // Test setup is intentionally captured once, matching component initialization.
  // svelte-ignore state_referenced_locally
  const debouncer = createDebouncer(fn, { wait });
  // svelte-ignore state_referenced_locally
  onReady(debouncer);

  $effect(() => {
    onOwnedEffect();
  });
</script>
