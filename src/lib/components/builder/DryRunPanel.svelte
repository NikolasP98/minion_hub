<script lang="ts">
  import { Button } from '$lib/components/ui';
import * as m from '$lib/paraglide/messages';
    import { submitOnEnter } from '$lib/hotkeys';
    import { autosize } from '$lib/actions/autosize';
    import { X, Play, Loader2, CheckCircle2, XCircle, Clock, Zap, AlertTriangle, BarChart3, Sparkles } from 'lucide-svelte';
    import { onMount } from 'svelte';
    import {
        skillEditorState, startDryRun, clearDryRun,
        dryRunSuggestions, fetchTestPromptSuggestions,
        type DryRunChapterResult, type DryRunAnalysisDimension,
    } from '$lib/state/builder/skill-editor.svelte';

    let promptInput = $state('');
    let expandedChapter = $state<string | null>(null);

    const dryRun = $derived(skillEditorState.dryRun);
    const hasChapters = $derived(skillEditorState.chapters.filter(c => c.type !== 'condition').length > 0);

    // Auto-fetch suggested prompts when panel mounts
    onMount(() => {
        if (hasChapters && dryRunSuggestions.prompts.length === 0) {
            fetchTestPromptSuggestions();
        }
    });

    function usePrompt(text: string) {
        promptInput = text;
    }

    function handleRun() {
        if (!promptInput.trim() || !hasChapters) return;
        startDryRun(promptInput.trim());
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
            case 'done': return 'var(--color-success, var(--color-success-fg))';
            case 'error': return 'var(--color-danger-fg)';
            case 'running': return 'var(--color-accent)';
            default: return 'var(--color-muted)';
        }
    }

    function toggleExpand(chapterId: string) {
        expandedChapter = expandedChapter === chapterId ? null : chapterId;
    }
</script>

<aside class="dry-run-panel" aria-label={m.builder_dryRunLabel()}>
    <!-- Header -->
    <div class="panel-header">
        <span class="panel-title">{m.builder_testRun()}</span>
        <Button variant="ghost" class="close-btn" onclick={clearDryRun} aria-label={m.common_close()}>
            <X size={14} />
        </Button>
    </div>

    <!-- Prompt input -->
    <div class="prompt-section">
        <label class="prompt-label" for="dry-run-prompt">{m.builder_testPrompt()}</label>
        <textarea
            id="dry-run-prompt"
            class="prompt-input"
            use:autosize={{ value: promptInput, max: 200 }}
            bind:value={promptInput}
            {@attach submitOnEnter(() => handleRun())}
            placeholder={m.builder_testPromptPlaceholder()}
            disabled={dryRun?.running}
        ></textarea>
        <!-- Suggested prompts -->
        {#if dryRunSuggestions.loading}
            <div class="suggestions-loading">
                <Loader2 size={11} class="spin" />
                <span>{m.builder_generatingTestIdeas()}</span>
            </div>
        {:else if dryRunSuggestions.prompts.length > 0 && !promptInput.trim()}
            <div class="suggestions-row">
                {#each dryRunSuggestions.prompts as suggestion (suggestion.label)}
                    <Button variant="ghost"
                        class="suggestion-pill"
                        onclick={() => usePrompt(suggestion.text)}
                        title={suggestion.text}
                    >
                        <Sparkles size={10} />
                        {suggestion.label}
                    </Button>
                {/each}
            </div>
        {/if}

        <Button variant="ghost"
            class="run-btn"
            onclick={handleRun}
            disabled={!promptInput.trim() || !hasChapters || dryRun?.running}
        >
            {#if dryRun?.running}
                <Loader2 size={14} class="spin" />
                {m.builder_running()}
            {:else}
                <Play size={14} />
                {m.builder_runTest()}
            {/if}
        </Button>
        {#if !hasChapters}
            <span class="prompt-hint">{m.builder_addChaptersFirst()}</span>
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
                    <span class="metric-label">{dryRun.results.filter(r => r.status === 'done').length}/{dryRun.results.length} {m.builder_chapters()}</span>
                </div>
            </div>

            <!-- Per-chapter results -->
            <div class="chapter-results">
                {#each dryRun.results as result (result.chapterId)}
                    {@const Icon = statusIcon(result.status)}
                    <div class="result-card" class:expanded={expandedChapter === result.chapterId}>
                        <Button variant="ghost" class="result-header" onclick={() => toggleExpand(result.chapterId)}>
                            <span class="result-status" style="color: {statusColor(result.status)}">
                                <Icon size={14} class={result.status === 'running' ? 'spin' : ''} />
                            </span>
                            <span class="result-name">{result.chapterName}</span>
                            {#if result.status === 'done'}
                                <span class="result-meta">{result.durationMs}ms · {result.promptTokens + result.completionTokens} tok</span>
                            {/if}
                        </Button>

                        {#if expandedChapter === result.chapterId}
                            <div class="result-body">
                                {#if result.status === 'error'}
                                    <div class="result-error">{result.error}</div>
                                {:else if result.status === 'done'}
                                    <pre class="result-output">{result.output}</pre>
                                {:else if result.status === 'running'}
                                    <div class="result-running">{m.builder_executing()}</div>
                                {:else}
                                    <div class="result-pending">{m.builder_waitingUpstream()}</div>
                                {/if}
                            </div>
                        {/if}
                    </div>
                {/each}
            <!-- Analysis scorecard -->
            {#if dryRun.analyzing}
                <div class="analysis-loading">
                    <Loader2 size={14} class="spin" />
                    <span>{m.builder_analyzingPipeline()}</span>
                </div>
            {:else if dryRun.analysis}
                <div class="analysis-section">
                    <div class="analysis-header">
                        <BarChart3 size={14} />
                        <span>{m.builder_qualityScore()}</span>
                        <span class="overall-score" class:good={dryRun.analysis.overallScore >= 70} class:warn={dryRun.analysis.overallScore >= 40 && dryRun.analysis.overallScore < 70} class:bad={dryRun.analysis.overallScore < 40}>
                            {dryRun.analysis.overallScore}
                        </span>
                    </div>

                    <div class="dimensions">
                        {#each dryRun.analysis.dimensions as dim (dim.name)}
                            <div class="dimension-row">
                                <div class="dim-header">
                                    <span class="dim-verdict" class:pass={dim.verdict === 'pass'} class:warn={dim.verdict === 'warn'} class:fail={dim.verdict === 'fail'}>
                                        {#if dim.verdict === 'pass'}<CheckCircle2 size={12} />{:else if dim.verdict === 'warn'}<AlertTriangle size={12} />{:else}<XCircle size={12} />{/if}
                                    </span>
                                    <span class="dim-name">{dim.name}</span>
                                    <span class="dim-score">{dim.score}</span>
                                </div>
                                <p class="dim-details">{dim.details}</p>
                            </div>
                        {/each}
                    </div>

                    {#if dryRun.analysis.recommendations?.length}
                        <div class="recommendations">
                            <span class="rec-label">{m.builder_recommendations()}</span>
                            {#each dryRun.analysis.recommendations as rec, i (i)}
                                <div class="rec-item">
                                    <span class="rec-number">{i + 1}</span>
                                    <span class="rec-text">{rec}</span>
                                </div>
                            {/each}
                        </div>
                    {/if}
                </div>
            {/if}

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
        padding: 0 var(--space-4);
        background: var(--color-bg2);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .panel-title {
        font-size: var(--font-size-body);
        font-weight: 600;
        color: var(--color-foreground);
    }

    :global(.close-btn) {
        background: none;
        border: none;
        color: var(--color-muted);
        cursor: pointer;
        padding: var(--space-1);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        transition: color var(--duration-fast);
    }
    :global(.close-btn:hover) { color: var(--color-foreground); }

    /* Prompt */
    .prompt-section {
        padding: var(--space-3) var(--space-4);
        border-bottom: 1px solid var(--color-border);
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .prompt-label {
        font-size: var(--font-size-caption);
        font-weight: 600;
        color: var(--color-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .prompt-input {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-foreground);
        font-family: inherit;
        font-size: var(--font-size-body);
        padding: var(--space-2) var(--space-2);
        outline: none;
        resize: vertical;
        max-height: 200px;
        overflow-y: auto;
        transition: border-color var(--duration-fast);
    }
    .prompt-input:focus { border-color: var(--color-accent); }
    .prompt-input::placeholder { color: var(--color-muted); }

    /* Suggested prompts */
    .suggestions-loading {
        display: flex; align-items: center; gap: var(--space-2);
        font-size: var(--font-size-caption); color: var(--color-muted); opacity: 0.6;
    }
    .suggestions-row {
        display: flex; flex-wrap: wrap; gap: var(--space-1);
    }
    :global(.suggestion-pill) {
        display: inline-flex; align-items: center; gap: var(--space-1);
        padding: var(--space-1) var(--space-2);
        font-size: var(--font-size-caption); font-weight: 500; font-family: inherit;
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 6%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-accent) 20%, transparent);
        border-radius: var(--radius-full);
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
    }
    :global(.suggestion-pill:hover) {
        background: color-mix(in srgb, var(--color-accent) 12%, transparent);
        border-color: color-mix(in srgb, var(--color-accent) 35%, transparent);
    }

    :global(.run-btn) {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        font-size: var(--font-size-caption);
        font-weight: 600;
        font-family: inherit;
        color: white;
        background: var(--color-accent);
        border: none;
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: filter var(--duration-fast);
    }
    :global(.run-btn:hover:not(:disabled)) { filter: brightness(1.15); }
    :global(.run-btn:disabled) { opacity: 0.5; cursor: not-allowed; }

    .prompt-hint {
        font-size: var(--font-size-caption);
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
        gap: var(--space-3);
        padding: var(--space-2) var(--space-4);
        background: var(--color-bg2);
        border-bottom: 1px solid var(--color-border);
    }

    .metric {
        display: flex;
        align-items: center;
        gap: var(--space-1);
        font-size: var(--font-size-caption);
        color: var(--color-muted);
    }

    .metric-label {
        font-size: var(--font-size-caption);
        color: var(--color-muted);
        margin-left: auto;
    }

    .chapter-results {
        padding: var(--space-1);
    }

    .result-card {
        border-radius: var(--radius-md);
        margin-bottom: var(--space-0-5);
        overflow: hidden;
    }

    :global(.result-header) {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        width: 100%;
        padding: var(--space-2) var(--space-3);
        background: transparent;
        border: none;
        cursor: pointer;
        font-family: inherit;
        font-size: var(--font-size-caption);
        text-align: left;
        color: var(--color-foreground);
        border-radius: var(--radius-md);
        transition: background var(--duration-fast);
    }
    :global(.result-header:hover) { background: var(--color-bg3); }

    .result-status { display: flex; flex-shrink: 0; }
    .result-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
    .result-meta { font-size: var(--font-size-telemetry); color: var(--color-muted); flex-shrink: 0; }

    .result-body {
        padding: 0 var(--space-3) var(--space-2);
    }

    .result-output {
        font-family: 'JetBrains Mono', 'Fira Code', monospace;
        font-size: var(--font-size-caption);
        line-height: 1.5;
        color: var(--color-foreground);
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: var(--space-2);
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 200px;
        overflow-y: auto;
    }

    .result-error {
        font-size: var(--font-size-caption);
        color: var(--color-danger-fg);
        background: var(--color-danger-surface);
        border-radius: var(--radius-md);
        padding: var(--space-2) var(--space-2);
    }

    .result-running {
        font-size: var(--font-size-caption);
        color: var(--color-accent);
        font-style: italic;
    }

    .result-pending {
        font-size: var(--font-size-caption);
        color: var(--color-muted);
        opacity: 0.6;
    }

    /* Analysis */
    .analysis-loading {
        display: flex; align-items: center; gap: var(--space-2);
        padding: var(--space-3) var(--space-4); font-size: var(--font-size-caption); color: var(--color-accent);
    }

    .analysis-section {
        border-top: 1px solid var(--color-border);
    }

    .analysis-header {
        display: flex; align-items: center; gap: var(--space-2);
        padding: var(--space-2) var(--space-4);
        font-size: var(--font-size-caption); font-weight: 600;
        color: var(--color-foreground);
        background: var(--color-bg2);
        border-bottom: 1px solid var(--color-border);
    }

    .overall-score {
        margin-left: auto;
        font-size: var(--font-size-page-title); font-weight: 700;
        font-family: var(--font-mono, monospace);
    }
    .overall-score.good { color: var(--color-success, var(--color-success-fg)); }
    .overall-score.warn { color: var(--color-warning, var(--color-warning-fg)); }
    .overall-score.bad { color: var(--color-danger-fg); }

    .dimensions { padding: var(--space-1) var(--space-3); }

    .dimension-row {
        padding: var(--space-2) 0;
        border-bottom: 1px solid color-mix(in srgb, var(--color-border) 40%, transparent);
    }
    .dimension-row:last-child { border-bottom: none; }

    .dim-header {
        display: flex; align-items: center; gap: var(--space-2);
        font-size: var(--font-size-caption);
    }
    .dim-verdict { display: flex; }
    .dim-verdict.pass { color: var(--color-success, var(--color-success-fg)); }
    .dim-verdict.warn { color: var(--color-warning, var(--color-warning-fg)); }
    .dim-verdict.fail { color: var(--color-danger-fg); }

    .dim-name { flex: 1; font-weight: 500; color: var(--color-foreground); }
    .dim-score {
        font-family: var(--font-mono, monospace); font-size: var(--font-size-caption); font-weight: 600;
        color: var(--color-muted);
    }

    .dim-details {
        font-size: var(--font-size-caption); color: var(--color-muted); line-height: 1.4;
        margin: var(--space-0-5) 0 0 var(--space-6);
    }

    .recommendations {
        padding: var(--space-2) var(--space-3);
        border-top: 1px solid var(--color-border);
    }
    .rec-label {
        font-size: var(--font-size-caption); font-weight: 600; text-transform: uppercase;
        letter-spacing: 0.04em; color: var(--color-muted); display: block;
        margin-bottom: var(--space-2);
    }
    .rec-item {
        display: flex; align-items: flex-start; gap: var(--space-2);
        padding: var(--space-1) 0; font-size: var(--font-size-caption); color: var(--color-foreground);
        line-height: 1.4;
    }
    .rec-number {
        width: 18px; height: 18px; border-radius: var(--radius-full);
        background: var(--color-bg3); color: var(--color-muted);
        font-size: var(--font-size-telemetry); font-weight: 600;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; margin-top: 1px;
    }
    .rec-text { flex: 1; }

    :global(.spin) {
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
</style>
