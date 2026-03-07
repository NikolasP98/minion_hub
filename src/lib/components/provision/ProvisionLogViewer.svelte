<script lang="ts">
    import { provisionState } from "$lib/state/features/provision.svelte";
    import { Terminal } from "lucide-svelte";

    let logContainer: HTMLDivElement | undefined = $state();

    // Strip ANSI escape codes
    function stripAnsi(str: string): string {
        return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
    }

    // Auto-scroll to bottom when new logs arrive
    $effect(() => {
        // Access logs.length to trigger reactivity
        const _len = provisionState.logs.length;
        if (logContainer) {
            requestAnimationFrame(() => {
                if (logContainer) {
                    logContainer.scrollTop = logContainer.scrollHeight;
                }
            });
        }
    });
</script>

<div class="bg-card border border-border rounded-lg overflow-hidden flex flex-col h-full">
    <div class="flex items-center gap-2 px-3 py-2 border-b border-border bg-bg/50">
        <Terminal size={13} class="text-muted-foreground/70" />
        <span class="text-xs font-semibold text-foreground uppercase tracking-wider">Output</span>
        {#if provisionState.running}
            <span class="ml-auto text-[10px] text-accent font-medium animate-pulse">Live</span>
        {/if}
        <span class="text-[10px] text-muted-foreground/60 {provisionState.running ? '' : 'ml-auto'}">
            {provisionState.logs.length} lines
        </span>
    </div>

    <div
        bind:this={logContainer}
        class="flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed min-h-[200px] max-h-[500px]"
        style="background: var(--color-bg); color: var(--color-foreground);"
    >
        {#if provisionState.logs.length === 0}
            <p class="text-muted-foreground/40 text-center py-8">
                No output yet. Run provisioning to see logs here.
            </p>
        {:else}
            {#each provisionState.logs as line, i (i)}
                <div class="whitespace-pre-wrap break-all hover:bg-bg2/50 px-1 -mx-1 rounded
                    {line.startsWith('ERROR') ? 'text-destructive' :
                     line.startsWith('[Process exited') ? 'text-muted-foreground font-semibold' :
                     line.includes('===') ? 'text-accent font-semibold' : ''}">
                    {stripAnsi(line)}
                </div>
            {/each}
        {/if}
    </div>
</div>
