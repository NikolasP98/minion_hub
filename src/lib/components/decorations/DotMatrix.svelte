<script lang="ts">
  let { data = [], cols = 8, color = 'var(--color-accent)' }: {
    data?: number[];
    cols?: number;
    color?: string;
  } = $props();
</script>

<div
  class="grid gap-[2px]"
  style="grid-template-columns: repeat({cols}, 4px);"
>
  {#each data as value}
    <div
      class="w-1 h-1 rounded-full"
      style="background: {color}; opacity: {Math.max(0.1, value)};"
    ></div>
  {/each}
</div>
