<script lang="ts">
  import { Loader2 } from 'lucide-svelte';

  interface Props {
    size?: 'xs' | 'sm' | 'md' | 'lg';
    class?: string;
    label?: string;
  }

  let { size = 'md', class: cls = '', label }: Props = $props();

  const px = { xs: 10, sm: 12, md: 16, lg: 20 } as const;
</script>

<Loader2
  size={px[size]}
  class={`animate-spin text-muted-foreground ${cls}`}
  aria-hidden={label ? undefined : 'true'}
  aria-label={label}
  role={label ? 'status' : undefined}
/>
