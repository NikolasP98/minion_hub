<script lang="ts">
    import { XCircle, AlertTriangle, X } from 'lucide-svelte';
    import {
        skillEditorState, skillEditorDerived,
        openConditionOrChapter, publishSkill,
    } from '$lib/state/builder/skill-editor.svelte';
    import type { ValidationFinding } from '$lib/utils/skill-validation';

    // Skill-level findings (no chapter associated)
    const skillFindings = $derived(
        skillEditorDerived.validationFindings.filter((f: ValidationFinding) => f.chapterId === null)
    );

    // Per-chapter grouped findings
    const chapterGroups = $derived.by(() => {
        const map = new Map<string, { name: string; findings: ValidationFinding[] }>();
        for (const f of skillEditorDerived.validationFindings) {
            if (f.chapterId === null) continue;
            if (!map.has(f.chapterId)) {
                map.set(f.chapterId, { name: f.chapterName ?? f.chapterId, findings: [] });
            }
            map.get(f.chapterId)!.findings.push(f);
        }
        return map;
    });

    // Count of chapters with no findings
    const passingCount = $derived(skillEditorState.chapters.length - chapterGroups.size);

    // Header text following copywriting contract
    const headerText = $derived.by(() => {
        const { errors, warnings } = skillEditorDerived.validationCounts;
        const ePlural = errors !== 1 ? 's' : '';
        const wPlural = warnings !== 1 ? 's' : '';
        if (errors > 0 && warnings > 0) return `Validation — ${errors} error${ePlural}, ${warnings} warning${wPlural}`;
        if (errors > 0) return `Validation — ${errors} error${ePlural}`;
        if (warnings > 0) return `Validation — ${warnings} warning${wPlural}`;
        return 'Validation — all clear';
    });
</script>

<aside role="complementary" aria-label="Skill validation" class="validation-panel">
    <!-- HEADER -->
    <div class="panel-header">
        <span class="panel-title">{headerText}</span>
        <button
            class="close-btn"
            onclick={() => { skillEditorState.showValidation = false; skillEditorState.publishAnyway = false; }}
            aria-label="Close validation panel"
        >
            <X size={14} />
        </button>
    </div>

    <!-- BODY -->
    <div class="panel-body">
        <!-- Skill-level findings -->
        {#if skillFindings.length > 0}
            <div class="chapter-group">
                <div class="chapter-group-header">
                    <span class="chapter-group-name">Skill</span>
                </div>
                {#each skillFindings as finding (finding.message)}
                    <div class="validation-row {finding.level}">
                        {#if finding.level === 'error'}
                            <XCircle size={12} class="finding-icon error" />
                        {:else}
                            <AlertTriangle size={12} class="finding-icon warning" />
                        {/if}
                        <span>{finding.message}</span>
                    </div>
                {/each}
            </div>
        {/if}

        <!-- Per-chapter groups -->
        {#each [...chapterGroups.entries()] as [chapterId, group] (chapterId)}
            <div class="chapter-group">
                <div class="chapter-group-header">
                    <span class="chapter-group-name">{group.name}</span>
                    <button
                        class="fix-btn"
                        onclick={() => {
                            const ch = skillEditorState.chapters.find(c => c.id === chapterId);
                            if (ch) openConditionOrChapter(ch);
                        }}
                    >Fix &#x2192;</button>
                </div>
                {#each group.findings as finding (finding.message)}
                    <div class="validation-row {finding.level}">
                        {#if finding.level === 'error'}
                            <XCircle size={12} class="finding-icon error" />
                        {:else}
                            <AlertTriangle size={12} class="finding-icon warning" />
                        {/if}
                        <span>{finding.message}</span>
                    </div>
                {/each}
            </div>
        {/each}
    </div>

    <!-- FOOTER -->
    <div class="panel-footer">
        <span class="passing-count">{passingCount} chapter{passingCount !== 1 ? 's' : ''} passing</span>
        {#if skillEditorState.publishAnyway}
            <button class="publish-anyway-btn" onclick={() => { publishSkill(); }}>
                Publish Anyway
            </button>
        {/if}
    </div>
</aside>

<style>
    .validation-panel {
        width: 280px;
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
        justify-content: center;
        transition: color 0.15s ease;
    }

    .close-btn:hover {
        color: var(--color-foreground);
    }

    .panel-body {
        flex: 1;
        overflow-y: auto;
        padding: 8px 16px;
    }

    .chapter-group {
        margin-top: 8px;
    }

    .chapter-group:first-child {
        margin-top: 0;
    }

    .chapter-group-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 0 4px 0;
        border-top: 1px solid color-mix(in srgb, var(--color-border) 50%, transparent);
    }

    .chapter-group:first-child .chapter-group-header {
        border-top: none;
        padding-top: 4px;
    }

    .chapter-group-name {
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--color-muted);
    }

    .fix-btn {
        font-size: 0.625rem;
        font-weight: 600;
        padding: 4px 8px;
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
        border-radius: var(--radius-sm, 4px);
        cursor: pointer;
        font-family: inherit;
        transition: background 0.15s ease;
    }

    .fix-btn:hover {
        background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    }

    .validation-row {
        display: flex;
        align-items: flex-start;
        gap: 4px;
        padding: 4px 8px;
        border-radius: var(--radius-sm, 4px);
        font-size: 0.75rem;
        line-height: 1.4;
        color: var(--color-foreground);
        margin-bottom: 2px;
    }

    .validation-row.error {
        background: color-mix(in srgb, var(--color-destructive, #ef4444) 8%, transparent);
    }

    .validation-row.warning {
        background: color-mix(in srgb, var(--color-warning, #f59e0b) 8%, transparent);
    }

    :global(.finding-icon.error) {
        color: var(--color-destructive, #ef4444);
        flex-shrink: 0;
        margin-top: 2px;
    }

    :global(.finding-icon.warning) {
        color: var(--color-warning, #f59e0b);
        flex-shrink: 0;
        margin-top: 2px;
    }

    .panel-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 16px;
        background: var(--color-bg2);
        border-top: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .passing-count {
        font-size: 0.6875rem;
        font-weight: 400;
        color: var(--color-muted);
    }

    .publish-anyway-btn {
        font-size: 0.75rem;
        font-weight: 600;
        padding: 6px 12px;
        color: white;
        background: var(--color-accent);
        border: none;
        border-radius: 0.375rem;
        cursor: pointer;
        font-family: inherit;
        transition: filter 0.15s ease;
    }

    .publish-anyway-btn:hover {
        filter: brightness(1.1);
    }
</style>
