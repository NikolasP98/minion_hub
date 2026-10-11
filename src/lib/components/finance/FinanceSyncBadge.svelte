<script lang="ts">
  import { financeSync } from '$lib/state/features/finance-sync.svelte';
  import { Spinner } from '$lib/components/ui';
</script>

{#if financeSync.active}
  <span class="badge" title={`${financeSync.percent}%`}>
    <Spinner size="xs" />
  </span>
{/if}

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: auto;
  }
</style>
