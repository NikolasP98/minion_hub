<script lang="ts">
    import { onMount } from "svelte";

    // Anti-flash: don't show skeleton for first 150ms to prevent flash on fast loads
    let visible = $state(false);

    onMount(() => {
        const timer = setTimeout(() => { visible = true; }, 150);
        return () => clearTimeout(timer);
    });
</script>

{#if visible}
    <div class="max-w-2xl mx-auto space-y-4 p-6 md:p-10">
        {#each { length: 4 } as _, i}
            <div class="bg-card border border-border rounded-lg px-5 py-4 overflow-hidden">
                <!-- Fake header -->
                <div class="skeleton-line h-3 rounded mb-4" style="width: {50 + (i % 3) * 15}%"></div>
                <!-- Fake field lines -->
                <div class="space-y-3">
                    <div class="skeleton-line h-2.5 rounded" style="width: {70 + (i % 2) * 20}%"></div>
                    <div class="skeleton-line h-2.5 rounded" style="width: {55 + (i % 3) * 10}%"></div>
                    <div class="skeleton-line h-2.5 rounded" style="width: {80 - (i % 2) * 15}%"></div>
                    {#if i % 2 === 0}
                        <div class="skeleton-line h-2.5 rounded" style="width: 45%"></div>
                    {/if}
                </div>
            </div>
        {/each}
    </div>
{/if}

<style>
    .skeleton-line {
        background: linear-gradient(
            90deg,
            var(--color-bg3) 25%,
            var(--color-border) 50%,
            var(--color-bg3) 75%
        );
        background-size: 200% 100%;
        animation: shimmer 1.5s ease-in-out infinite;
    }

    @keyframes shimmer {
        0%   { background-position: 200% 0; }
        100% { background-position: -200% 0; }
    }
</style>
