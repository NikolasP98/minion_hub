<script lang="ts">
    /**
     * PreviewPanel — right pane of /(app)/prompt.
     *
     * Renders three stacked regions:
     *   1. Sticky totals bar (grand bytes + tokens)
     *   2. Per-section breakdown table (id | layer badge | source pill | bytes | tokens | cacheable ✓)
     *   3. Monospace `<pre>` of the assembled prompt
     *
     * Data source: `promptSections.preview` — populated by the debounced $effect
     * in PromptShell (20-04 Task 2) which calls `previewSections(agentId, mode, draftOverride?)`.
     * This component is read-only; all RPC fetching / debouncing happens upstream.
     */
    import { promptSections } from "$lib/state/features/prompt-sections.svelte";
    import { colorForLayer } from "$lib/utils/layer-colors";
    import { formatBytes, formatTokens } from "$lib/utils/format";
    import MarkdownView from "./MarkdownView.svelte";

    const preview = $derived(promptSections.preview);
    const loading = $derived(promptSections.previewLoading);
    const hasAgent = $derived(promptSections.agentId !== null);
    const activeId = $derived(promptSections.activeId);

    // Show a spinner only for the initial load (preview === null while an agent is
    // selected). Subsequent debounced refetches keep the previous breakdown visible
    // so the pane doesn't flicker on every keystroke.
    const showInitialSpinner = $derived(
        hasAgent && preview === null && loading,
    );

    // Refs for auto-scroll behavior. When the user picks a section in the
    // browser, scroll its row in the breakdown table AND its rendered region
    // in the assembled prompt into view, with a brief highlight pulse.
    let breakdownScroll: HTMLDivElement;
    let assembledScroll: HTMLDivElement;
    let highlightTick = $state(0);

    $effect(() => {
        const id = activeId;
        if (!id || !preview) return;
        // Bump tick first so CSS animation restarts on each selection.
        highlightTick++;
        // Defer to next tick so DOM has the new data attributes wired.
        queueMicrotask(() => {
            const row = breakdownScroll?.querySelector<HTMLElement>(
                `[data-section-id="${CSS.escape(id)}"]`,
            );
            row?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            const block = assembledScroll?.querySelector<HTMLElement>(
                `[data-section-id="${CSS.escape(id)}"]`,
            );
            block?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    });
</script>

<div class="flex flex-col h-full">
    <!-- Sticky grand totals -->
    <div
        class="shrink-0 border-b border-border px-4 py-2 flex items-center justify-between bg-bg1/80 backdrop-blur-sm"
    >
        <div class="text-xs uppercase tracking-wide text-muted font-medium">
            Preview
        </div>
        <div class="flex items-center gap-3 text-xs">
            {#if preview}
                <span class="font-mono text-fg">
                    {formatBytes(preview.totalBytes)}
                </span>
                <span class="text-muted/60">·</span>
                <span class="font-mono text-fg">
                    {formatTokens(preview.totalTokens)}
                </span>
                {#if loading}
                    <span
                        class="inline-block w-3 h-3 rounded-full border-2 border-accent/40 border-t-accent animate-spin"
                        aria-label="Refreshing"
                    ></span>
                {/if}
            {:else}
                <span class="font-mono text-muted">-- / --</span>
            {/if}
        </div>
    </div>

    {#if showInitialSpinner}
        <div class="flex-1 flex items-center justify-center text-sm text-muted">
            <div class="flex items-center gap-2">
                <span
                    class="inline-block w-4 h-4 rounded-full border-2 border-accent/40 border-t-accent animate-spin"
                ></span>
                <span>Assembling...</span>
            </div>
        </div>
    {:else if !preview}
        <div class="flex-1 flex items-center justify-center text-xs text-muted px-4 text-center">
            Select an agent to preview the assembled prompt.
        </div>
    {:else}
        <!-- Breakdown table (Source column removed — always builtin/custom is
             already shown via the dot color; redundant) -->
        <div bind:this={breakdownScroll} class="shrink-0 border-b border-border overflow-x-auto max-h-[40vh]">
            <table class="w-full text-xs">
                <thead class="text-muted sticky top-0 bg-bg1">
                    <tr class="border-b border-border/60">
                        <th class="text-left px-3 py-1.5 font-medium">Section</th>
                        <th class="text-left px-2 py-1.5 font-medium">Layer</th>
                        <th class="text-right px-2 py-1.5 font-medium">Bytes</th>
                        <th class="text-right px-2 py-1.5 font-medium">Tokens</th>
                        <th class="text-center px-2 py-1.5 font-medium" title="Cacheable">⚡</th>
                    </tr>
                </thead>
                <tbody>
                    {#each preview.breakdown as row (row.id)}
                        {@const color = colorForLayer(row.layer)}
                        {@const isActive = row.id === activeId}
                        <tr
                            data-section-id={row.id}
                            class={`border-b border-border/30 transition-colors ${isActive ? "bg-accent/10 ring-1 ring-accent/40 highlight-pulse" : "hover:bg-bg2/40"}`}
                            data-pulse={isActive ? highlightTick : 0}
                        >
                            <td class="px-3 py-1 font-mono text-fg truncate max-w-[14ch]" title={row.id}>
                                <span class="inline-block w-1.5 h-1.5 rounded-full align-middle mr-1.5 {color.dot}"></span>
                                {row.id}
                            </td>
                            <td class="px-2 py-1">
                                <span class="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide {color.badge}">
                                    {row.layer}
                                </span>
                            </td>
                            <td class="px-2 py-1 text-right font-mono text-fg">
                                {formatBytes(row.bytes)}
                            </td>
                            <td class="px-2 py-1 text-right font-mono text-fg">
                                {row.tokens.toLocaleString("en-US")}
                            </td>
                            <td class="px-2 py-1 text-center text-muted">
                                {row.cacheable ? "✓" : ""}
                            </td>
                        </tr>
                    {/each}
                </tbody>
            </table>
        </div>

        <!-- Assembled prompt: per-section markdown blocks with data attrs for
             auto-scroll. Falls back to monospace pre-render of preview.assembled
             only if breakdown.rendered is unavailable. -->
        <div bind:this={assembledScroll} class="flex-1 overflow-auto p-4 space-y-4">
            {#each preview.breakdown as row (row.id)}
                {@const isActive = row.id === activeId}
                <section
                    data-section-id={row.id}
                    class={`scroll-mt-4 rounded transition-colors ${isActive ? "ring-1 ring-accent/40 bg-accent/5 highlight-pulse" : ""}`}
                >
                    {#if row.rendered}
                        <MarkdownView value={row.rendered} />
                    {:else}
                        <pre class="text-xs font-mono whitespace-pre-wrap break-words text-fg/70">{`# ${row.id} (no content)`}</pre>
                    {/if}
                </section>
            {/each}
        </div>
    {/if}
</div>

<style>
    /* Subtle pulse on active section selection. Bumping data-pulse restarts
       the animation each time the user picks the same section again. */
    :global(.highlight-pulse) {
        animation: pulse-fade 1.6s ease-out;
    }
    @keyframes pulse-fade {
        0% {
            background-color: rgb(var(--accent-rgb, 99 102 241) / 0.25);
        }
        100% {
            background-color: rgb(var(--accent-rgb, 99 102 241) / 0.05);
        }
    }
</style>
