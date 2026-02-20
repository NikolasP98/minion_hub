<script lang="ts">
  let { speed = 8, opacity = 0.03 }: { speed?: number; opacity?: number } = $props();
</script>

<div
  class="absolute inset-0 pointer-events-none overflow-hidden"
  style:opacity
>
  <div
    class="absolute left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-accent to-transparent"
    style="animation: scan-line {speed}s linear infinite"
  ></div>
</div>
