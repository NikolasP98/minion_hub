<script lang="ts">
  let { class: cls = '', width = '100%', height = '12px', rounded = 'rounded' }: {
    class?: string; width?: string; height?: string; rounded?: string;
  } = $props();
</script>

<div
  class="animate-pulse bg-bg3/60 {rounded} {cls}"
  style="width: {width}; height: {height};"
></div>
