<script lang="ts">
  let {
    value,
    class: cls = '',
    skeletonClass = '',
  }: {
    value: string | number | undefined | null;
    class?: string;
    skeletonClass?: string;
  } = $props();

  const isEmpty = $derived(value === undefined || value === null || value === '');
</script>

{#if isEmpty}
  <span
    class="inline-block rounded animate-pulse bg-[var(--color-border)] {skeletonClass}"
    aria-hidden="true"
  ></span>
{:else}
  <span class="fade-in {cls}">{value}</span>
{/if}

<style>
  .fade-in {
    animation: fadeIn 0.2s ease-in;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
</style>
