<script lang="ts">
    import { X, Play, Loader2, CheckCircle2, XCircle, Clock, Zap } from 'lucide-svelte';
    import {
        skillEditorState, startDryRun, clearDryRun,
        type DryRunChapterResult,
    } from '$lib/state/builder/skill-editor.svelte';

    let promptInput = $state('');
    let expandedChapter = $state<string | null>(null);

    const dryRun = $derived(skillEditorState.dryRun);
    const hasChapters = $derived(skillEditorState.chapters.filter(c => c.type !== 'condition').length > 0);

    function handleRun() {
        if (!promptInput.trim() || !hasChapters) return;
        startDryRun(promptInput.trim());
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === 'Enter' && !e.shiftKey && promptInput.trim()) {
            e.preventDefault();
            handleRun();
        }
    }

    function statusIcon(status: DryRunChapterResult['status']) {
        switch (status) {
            case 'done': return CheckCircle2;
            case 'error': return XCircle;
            case 'running': return Loader2;
            default: return Clock;
        }
    }

    function statusColor(status: DryRunChapterResult['status']) {
        switch (status) {
            case 'done': return 'var(--color-success, #22c55e)';
            case 'error': return 'var(--color-error, #ef4444)';
            case 'running': return 'var(--color-accent)';
            default: return 'var(--color-muted)';
        }
    }

    function toggleExpand(chapterId: string) {
        expandedChapter = expandedChapter === chapterId ? null : chapterId;
    }
</script>

<aside class="dry-run-panel" role="complementary" aria-label="Dry run">
    <!-- Header -->
    <div class="panel-header">
        <span class="panel-title">Test Run</span>
        <button class="close-btn" onclick={clearDryRun} aria-label="Close">
            <X size={14} />
        </button>
    </div>

    <!-- Prompt input -->
    <div class="prompt-section">
        <label class="prompt-label" for="dry-run-prompt">Test prompt</label>
        <textarea
            id="dry-run-prompt"
            class="prompt-input"
            rows="2"
            bind:value={promptInput}
            onkeydown={handleKeydown}
            placeholder="Enter a sample user message to test this skill..."
            disabled={dryRun?.running}
        ></textarea>
        <button
            class="run-btn"
            onclick={handleRun}
            disabled={!promptInput.trim() || !hasChapters || dryRun?.running}
        >
            {#if dryRun?.running}
                <Loader2 size={14} class="spin" />
                Running...
            {:else}
                <Play size={14} />
                Run Test
            {/if}
        </button>
        {#if !hasChapters}
            <span class="prompt-hint">Add chapters before running a test</span>
        {/if}
    </div>

    <!-- Results -->
    {#if dryRun}
        <div class="results-section">
            <!-- Summary metrics -->
            <div class="metrics-row">
                <div class="metric">
                    <Clock size={12} />
                    <span>{(dryRun.totalDurationMs / 1000).toFixed(1)}s</span>
                </div>
                <div class="metric">
                    <Zap size={12} />
                    <span>{dryRun.totalTokens.toLocaleString()} tokens</span>
                </div>
                <div class="metric">
                    <span class="metric-label">{dryRun.results.filter(r => r.status === 'done').length}/{dryRun.results.length} chapters</span>
                </div>
            </div>

            <!-- Per-chapter results -->
            <div class="chapter-results">
                {#each dryRun.results as result (result.chapterId)}
                    {@const Icon = statusIcon(result.status)}
                    <div class="result-card" class:expanded={expandedChapter === result.chapterId}>
                        <button class="result-header" onclick={() => toggleExpand(result.chapterId)}>
                            <span class="result-status" style="color: {statusColor(result.status)}">
                                <Icon size={14} class={result.status === 'running' ? 'spin' : ''} />
                            </span>
                            <span class="result-name">{result.chapterName}</span>
                            {#if result.status === 'done'}
                                <span class="result-meta">{result.durationMs}ms · {result.promptTokens + result.completionTokens} tok</span>
                            {/if}
                        </button>

                        {#if expandedChapter === result.chapterId}
                            <div class="result-body">
                                {#if result.status === 'error'}
                                    <div class="result-error">{result.error}</div>
                                {:else if result.status === 'done'}
                                    <pre class="result-output">{result.output}</pre>
                                {:else if result.status === 'running'}
                                    <div class="result-running">Executing...</div>
                                {:else}
                                    <div class="result-pending">Waiting for upstream chapters</div>
                                {/if}
                            </div>
                        {/if}
                    </div>
                {/each}
            </div>
        </div>
    {/if}
</aside>

<style>
    .dry-run-panel {
        width: 320px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        height: 100%;
        border-left: 1px solid var(--color-border);
        background: var(--color-bg);
    }

    .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 2.75rem;
        padding: 0 16px;
        background: var(--color-bg2);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .panel-title {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--color-foreground);
    }

    .close-btn {
        background: none;
        border: none;
        color: var(--color-muted);
        cursor: pointer;
        padding: 0.25rem;
        border-radius: 0.25rem;
        display: flex;
        align-items: center;
        transition: color 0.15s;
    }
    .close-btn:hover { color: var(--color-foreground); }

    /* Prompt */
    .prompt-section {
        padding: 12px 16px;
        border-bottom: 1px solid var(--color-border);
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .prompt-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--color-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .prompt-input {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-foreground);
        font-family: inherit;
        font-size: 13px;
        padding: 8px 10px;
        outline: none;
        resize: none;
        transition: border-color 0.15s;
    }
    .prompt-input:focus { border-color: var(--color-accent); }
    .prompt-input::placeholder { color: var(--color-muted); }

    .run-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 7px 14px;
        font-size: 12px;
        font-weight: 600;
        font-family: inherit;
        color: white;
        background: var(--color-accent);
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: filter 0.15s;
    }
    .run-btn:hover:not(:disabled) { filter: brightness(1.15); }
    .run-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .prompt-hint {
        font-size: 11px;
        color: var(--color-muted);
        opacity: 0.7;
    }

    /* Results */
    .results-section {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
    }

    .metrics-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px;
        background: var(--color-bg2);
        border-bottom: 1px solid var(--color-border);
    }

    .metric {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: var(--color-muted);
    }

    .metric-label {
        font-size: 11px;
        color: var(--color-muted);
        margin-left: auto;
    }

    .chapter-results {
        padding: 4px;
    }

    .result-card {
        border-radius: 6px;
        margin-bottom: 2px;
        overflow: hidden;
    }

    .result-header {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 8px 12px;
        background: transparent;
        border: none;
        cursor: pointer;
        font-family: inherit;
        font-size: 12px;
        text-align: left;
        color: var(--color-foreground);
        border-radius: 6px;
        transition: background 0.15s;
    }
    .result-header:hover { background: var(--color-bg3); }

    .result-status { display: flex; flex-shrink: 0; }
    .result-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
    .result-meta { font-size: 10px; color: var(--color-muted); flex-shrink: 0; }

    .result-body {
        padding: 0 12px 10px;
    }

    .result-output {
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        font-size: 11px;
        line-height: 1.5;
        color: var(--color-foreground);
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        padding: 10px;
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 200px;
        overflow-y: auto;
    }

    .result-error {
        font-size: 12px;
        color: var(--color-error, #ef4444);
        background: color-mix(in srgb, var(--color-error, #ef4444) 8%, transparent);
        border-radius: 6px;
        padding: 8px 10px;
    }

    .result-running {
        font-size: 12px;
        color: var(--color-accent);
        font-style: italic;
    }

    .result-pending {
        font-size: 12px;
        color: var(--color-muted);
        opacity: 0.6;
    }

    :global(.spin) {
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
</style>
