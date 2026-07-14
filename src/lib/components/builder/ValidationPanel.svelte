<script lang="ts">
  import { Button } from '$lib/components/ui';
import { XCircle, AlertTriangle, X } from 'lucide-svelte';
    import * as m from '$lib/paraglide/messages';
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
        if (errors > 0 && warnings > 0) return `${m.builder_validationTitle()} — ${errors} ${m.builder_error({ count: errors })}, ${warnings} ${m.builder_warning({ count: warnings })}`;
        if (errors > 0) return `${m.builder_validationTitle()} — ${errors} ${m.builder_error({ count: errors })}`;
        if (warnings > 0) return `${m.builder_validationTitle()} — ${warnings} ${m.builder_warning({ count: warnings })}`;
        return `${m.builder_validationTitle()} — ${m.builder_validationAllClear()}`;
    });
</script>

<aside aria-label={m.builder_skillValidation()} class="validation-panel">
    <!-- HEADER -->
    <div class="panel-header">
        <span class="panel-title">{headerText}</span>
        <Button variant="ghost"
            class="close-btn"
            onclick={() => { skillEditorState.showValidation = false; skillEditorState.publishAnyway = false; }}
            aria-label={m.builder_closeValidation()}
        >
            <X size={14} />
        </Button>
    </div>

    <!-- BODY -->
    <div class="panel-body">
        <!-- Skill-level findings -->
        {#if skillFindings.length > 0}
            <div class="chapter-group">
                <div class="chapter-group-header">
                    <span class="chapter-group-name">{m.builder_skillLabel()}</span>
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
                    <Button variant="ghost"
                        class="fix-btn"
                        onclick={() => {
                            const ch = skillEditorState.chapters.find(c => c.id === chapterId);
                            if (ch) openConditionOrChapter(ch);
                        }}
                    >{m.builder_fix()} &#x2192;</Button>
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
        <span class="passing-count">{m.builder_chaptersPassing({ count: passingCount })}</span>
        {#if skillEditorState.publishAnyway}
            <Button variant="ghost" class="publish-anyway-btn" onclick={() => { publishSkill(); }}>
                {m.builder_publishAnyway()}
            </Button>
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

    .close-btn {
        background: none;
        border: none;
        color: var(--color-muted);
        cursor: pointer;
        padding: var(--space-1);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color var(--duration-fast) var(--ease-standard);
    }

    .close-btn:hover {
        color: var(--color-foreground);
    }

    .panel-body {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-2) var(--space-4);
    }

    .chapter-group {
        margin-top: var(--space-2);
    }

    .chapter-group:first-child {
        margin-top: 0;
    }

    .chapter-group-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-2) 0 var(--space-1) 0;
        border-top: 1px solid color-mix(in srgb, var(--color-border) 50%, transparent);
    }

    .chapter-group:first-child .chapter-group-header {
        border-top: none;
        padding-top: var(--space-1);
    }

    .chapter-group-name {
        font-size: var(--font-size-caption);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--color-muted);
    }

    .fix-btn {
        font-size: var(--font-size-telemetry);
        font-weight: 600;
        padding: var(--space-1) var(--space-2);
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-accent) 25%, transparent);
        border-radius: var(--radius-sm, var(--radius-sm);
        cursor: pointer;
        font-family: inherit;
        transition: background var(--duration-fast) var(--ease-standard);
    }

    .fix-btn:hover {
        background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    }

    .validation-row {
        display: flex;
        align-items: flex-start;
        gap: var(--space-1);
        padding: var(--space-1) var(--space-2);
        border-radius: var(--radius-sm, var(--radius-sm);
        font-size: var(--font-size-caption);
        line-height: 1.4;
        color: var(--color-foreground);
        margin-bottom: var(--space-0-5);
    }

    .validation-row.error {
        background: color-mix(in srgb, var(--color-destructive, var(--color-danger-fg)) 8%, transparent);
    }

    .validation-row.warning {
        background: color-mix(in srgb, var(--color-warning, var(--color-warning-fg)) 8%, transparent);
    }

    :global(.finding-icon.error) {
        color: var(--color-destructive, var(--color-danger-fg));
        flex-shrink: 0;
        margin-top: var(--space-0-5);
    }

    :global(.finding-icon.warning) {
        color: var(--color-warning, var(--color-warning-fg));
        flex-shrink: 0;
        margin-top: var(--space-0-5);
    }

    .panel-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-2) var(--space-4);
        background: var(--color-bg2);
        border-top: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .passing-count {
        font-size: var(--font-size-caption);
        font-weight: 400;
        color: var(--color-muted);
    }

    .publish-anyway-btn {
        font-size: var(--font-size-caption);
        font-weight: 600;
        padding: var(--space-2) var(--space-3);
        color: white;
        background: var(--color-accent);
        border: none;
        border-radius: var(--radius-md);
        cursor: pointer;
        font-family: inherit;
        transition: filter var(--duration-fast) var(--ease-standard);
    }

    .publish-anyway-btn:hover {
        filter: brightness(1.1);
    }
</style>
