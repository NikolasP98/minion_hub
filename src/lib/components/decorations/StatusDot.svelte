<script lang="ts">
  let { status = 'idle', size = 'md' }: {
    status?: 'running' | 'thinking' | 'idle' | 'aborted';
    size?: 'sm' | 'md' | 'lg';
  } = $props();

  const sizeMap = { sm: 'w-2 h-2', md: 'w-2.5 h-2.5', lg: 'w-3 h-3' };
  const colorMap = { running: 'bg-success', thinking: 'bg-purple', idle: 'bg-muted-foreground', aborted: 'bg-warning' };
  const glowMap: Record<string, string> = {
    running: 'shadow-[0_0_6px_var(--color-success)]',
    thinking: 'shadow-[0_0_6px_var(--color-purple)]',
    idle: '',
    aborted: 'shadow-[0_0_6px_var(--color-warning)]',
  };
  const animMap: Record<string, string> = {
    running: 'animate-[dot-pulse_2s_ease_infinite]',
    thinking: 'animate-[dot-pulse_2s_ease_infinite]',
    idle: '',
    aborted: 'animate-[dot-pulse_1.5s_ease_infinite]',
  };
</script>

<div class="rounded-full shrink-0 {sizeMap[size]} {colorMap[status]} {glowMap[status]} {animMap[status]}"></div>
