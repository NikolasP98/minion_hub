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

    const preview = $derived(promptSections.preview);
    const loading = $derived(promptSections.previewLoading);
    const hasAgent = $derived(promptSections.agentId !== null);

    // Show a spinner only for the initial load (preview === null while an agent is
    // selected). Subsequent debounced refetches keep the previous breakdown visible
    // so the pane doesn't flicker on every keystroke.
    const showInitialSpinner = $derived(
        hasAgent && preview === null && loading,
    );
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
        <!-- Breakdown table -->
        <div class="shrink-0 border-b border-border overflow-x-auto">
            <table class="w-full text-xs">
                <thead class="text-muted">
                    <tr class="border-b border-border/60">
                        <th class="text-left px-3 py-1.5 font-medium">Section</th>
                        <th class="text-left px-2 py-1.5 font-medium">Layer</th>
                        <th class="text-left px-2 py-1.5 font-medium">Source</th>
                        <th class="text-right px-2 py-1.5 font-medium">Bytes</th>
                        <th class="text-right px-2 py-1.5 font-medium">Tokens</th>
                        <th class="text-center px-2 py-1.5 font-medium" title="Cacheable">⚡</th>
                    </tr>
                </thead>
                <tbody>
                    {#each preview.breakdown as row (row.id)}
                        {@const color = colorForLayer(row.layer)}
                        <tr class="border-b border-border/30 hover:bg-bg2/40">
                            <td class="px-3 py-1 font-mono text-fg truncate max-w-[14ch]" title={row.id}>
                                <span class="inline-block w-1.5 h-1.5 rounded-full align-middle mr-1.5 {color.dot}"></span>
                                {row.id}
                            </td>
                            <td class="px-2 py-1">
                                <span class="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide {color.badge}">
                                    {row.layer}
                                </span>
                            </td>
                            <td class="px-2 py-1">
                                <span
                                    class="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide {row.source === 'custom' ? 'bg-rose-500/15 text-rose-300' : 'bg-zinc-500/15 text-zinc-300'}"
                                >
                                    {row.source}
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

        <!-- Assembled prompt -->
        <div class="flex-1 overflow-auto">
            <pre
                class="text-xs font-mono p-4 whitespace-pre-wrap break-words text-fg/90 leading-relaxed"
            >{preview.assembled}</pre>
        </div>
    {/if}
</div>
