<script lang="ts">
  import { createSettledDay, type SettledDay } from '../settled-day.svelte';

  let {
    pageDay,
    view,
    replaceUrl,
    onReady,
    onOwnedEffect,
  }: {
    pageDay: string;
    view: string;
    replaceUrl: (params: URLSearchParams) => void;
    onReady: (settled: SettledDay) => void;
    onOwnedEffect: () => void;
  } = $props();

  // replaceUrl is a one-time dependency; pageDay and view remain reactive getters.
  // svelte-ignore state_referenced_locally
  const settled = createSettledDay({
    pageDay: () => pageDay,
    view: () => view,
    replaceUrl,
  });
  // svelte-ignore state_referenced_locally
  onReady(settled);

  $effect(() => {
    onOwnedEffect();
  });
</script>
