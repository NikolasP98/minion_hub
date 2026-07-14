<script lang="ts" module>
  export type { SpinnerProps, SpinnerSize } from '@minion-stack/ui';
</script>

<script lang="ts">
  import { Spinner as SharedSpinner, type SpinnerProps } from '@minion-stack/ui';

  let { size = 'md', class: cls = '', label }: SpinnerProps = $props();
</script>

<SharedSpinner {size} {label} class={cls} />
