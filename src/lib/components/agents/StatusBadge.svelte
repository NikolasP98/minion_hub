<script lang="ts">
    interface Props {
        status: 'running' | 'thinking' | 'idle' | 'error' | 'paused';
        size?: 'sm' | 'md' | 'lg';
    }

    let { status, size = 'md' }: Props = $props();

    const colors: Record<string, string> = {
        running: 'bg-status-running',
        thinking: 'bg-status-thinking',
        idle: 'bg-status-idle',
        error: 'bg-destructive',
        paused: 'bg-accent',
    };

    const glows: Record<string, string> = {
        running: 'shadow-[0_0_6px_var(--color-status-running)]',
        thinking: 'shadow-[0_0_6px_var(--color-status-thinking)]',
        idle: '',
        error: 'shadow-[0_0_6px_var(--color-destructive)]',
        paused: '',
    };

    const animations: Record<string, string> = {
        running: 'animate-pulse',
        thinking: 'animate-[pulse_2s_ease-in-out_infinite]',
        idle: '',
        error: '',
        paused: '',
    };

    const sizes: Record<string, string> = {
        sm: 'w-2 h-2',
        md: 'w-2.5 h-2.5',
        lg: 'w-3 h-3',
    };
</script>

<span
    class="inline-block rounded-full {colors[status]} {animations[status]} {glows[status]} {sizes[size]}"
    title={status}
></span>
