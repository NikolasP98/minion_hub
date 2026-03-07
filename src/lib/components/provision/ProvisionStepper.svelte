<script lang="ts">
    import { provisionState } from "$lib/state/features/provision.svelte";
    import { Circle, CheckCircle2, XCircle, Loader2, Play } from "lucide-svelte";

    interface Props {
        onrunfrom?: (phaseId: string) => void;
    }

    let { onrunfrom }: Props = $props();

    const firstResumable = $derived(() => {
        for (const phase of provisionState.phases) {
            if (phase.status !== 'complete') return phase.id;
        }
        return null;
    });
</script>

<div class="space-y-1">
    {#each provisionState.phases as phase, i (phase.id)}
        {@const isLast = i === provisionState.phases.length - 1}
        <div class="flex gap-3 relative">
            <!-- Vertical connector line -->
            {#if !isLast}
                <div class="absolute left-[11px] top-[24px] bottom-0 w-px
                    {phase.status === 'complete' ? 'bg-green-500/30' : 'bg-border'}"></div>
            {/if}

            <!-- Status icon -->
            <div class="shrink-0 mt-0.5 relative z-10">
                {#if phase.status === 'complete'}
                    <CheckCircle2 size={22} class="text-green-500" />
                {:else if phase.status === 'running'}
                    <Loader2 size={22} class="text-accent animate-spin" />
                {:else if phase.status === 'failed'}
                    <XCircle size={22} class="text-destructive" />
                {:else}
                    <Circle size={22} class="text-muted-foreground/40" />
                {/if}
            </div>

            <!-- Phase info -->
            <div class="flex-1 pb-3 min-w-0">
                <div class="flex items-center gap-2">
                    <span class="text-sm font-medium
                        {phase.status === 'complete' ? 'text-foreground' :
                         phase.status === 'running' ? 'text-accent' :
                         phase.status === 'failed' ? 'text-destructive' :
                         'text-muted-foreground'}">
                        {phase.name}
                    </span>
                    <span class="text-[10px] text-muted-foreground/60 font-mono">
                        Phase {phase.id}
                    </span>
                </div>
                <p class="text-xs text-muted-foreground mt-0.5">{phase.description}</p>

                <!-- Run from here button -->
                {#if !provisionState.running && phase.id === firstResumable() && onrunfrom}
                    <button
                        type="button"
                        class="flex items-center gap-1 mt-1.5 px-2 py-1 text-[11px] font-medium rounded bg-accent/10 text-accent border border-accent/20 cursor-pointer hover:bg-accent/20 transition-colors"
                        onclick={() => onrunfrom?.(phase.id)}
                    >
                        <Play size={10} />
                        Run from here
                    </button>
                {/if}
            </div>
        </div>
    {/each}
</div>
