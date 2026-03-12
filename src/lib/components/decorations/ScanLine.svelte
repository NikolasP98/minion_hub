<script lang="ts">
  let { speed = 8, opacity = 0.03, dual = false }: { speed?: number; opacity?: number; dual?: boolean } = $props();
</script>

<div
  class="absolute inset-0 pointer-events-none overflow-hidden"
  style:opacity
>
  {#if dual}
    <div
      class="absolute left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-accent to-transparent"
      style="animation: scan-line {speed}s linear infinite"
    ></div>
    <div
      class="absolute left-0 w-full h-[2px]"
      style="background: linear-gradient(to right, transparent, rgba(255,45,120,0.6), transparent); animation: scan-line {speed * 1.015}s linear infinite; animation-delay: -0.3s;"
    ></div>
  {:else}
    <div
      class="absolute left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-accent to-transparent"
      style="animation: scan-line {speed}s linear infinite"
    ></div>
  {/if}
</div>
