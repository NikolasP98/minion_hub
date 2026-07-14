<script lang="ts" module>
  /** Legacy pixel/percentage geometry retained around the canonical skeleton. */
  export interface SkeletonProps {
    class?: string;
    width?: string;
    height?: string;
    rounded?: string;
  }
</script>

<script lang="ts">
  import { Skeleton as SharedSkeleton } from '@minion-stack/ui';

  let {
    class: cls = '',
    width = '100%',
    height = '12px',
    rounded = 'rounded',
  }: SkeletonProps = $props();
</script>

<span
  class={`block overflow-hidden ${rounded}`}
  style:width
  style:height
  data-component="skeleton-compat"
>
  <SharedSkeleton
    shape="rect"
    class={`h-full w-full [&>[data-part='skeleton-line']]:!h-full [&>[data-part='skeleton-line']]:!min-h-0 ${cls}`}
  />
</span>
