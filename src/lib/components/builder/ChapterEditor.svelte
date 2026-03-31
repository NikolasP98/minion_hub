<script lang="ts">
    import {
        X,
        Check,
        Sparkles,
        Loader2,
        AlertCircle,
        ChevronDown,
        ChevronRight,
    } from "lucide-svelte";
    import { getToolInfo } from "$lib/data/tool-manifest";

    // ── Types ────────────────────────────────────────────────────────────────
    type FieldKey =
        | "name"
        | "description"
        | "triggerConditions"
        | "guide"
        | "context"
        | "outputDef"
        | "successCriteria";

    interface FieldConflict {
        userValue: string;
        aiValue: string;
    }

    interface ChapterData {
        id: string;
        name: string;
        description: string;
        guide: string;
        context: string;
        outputDef: string;
    }

    interface Props {
        chapter: ChapterData;
        availableToolIds: string[];
        chapterToolIds: string[];
        suggestedToolIds?: string[];
        skillName: string;
        skillDescription: string;
        onSave: (data: {
            name: string;
            description: string;
            guide: string;
            context: string;
            outputDef: string;
            toolIds: string[];
        }) => void;
        onClose: () => void;
    }

    let {
        chapter,
        availableToolIds,
        chapterToolIds,
        suggestedToolIds = [],
        skillName,
        skillDescription,
        onSave,
        onClose,
    }: Props = $props();

    // ── Local form state ──────────────────────────────────────────────────
    // svelte-ignore state_referenced_locally
    let name = $state(chapter.name);
    // svelte-ignore state_referenced_locally
    let description = $state(chapter.description);
    let triggerConditions = $state("");
    // svelte-ignore state_referenced_locally
    let guide = $state(chapter.guide);
    // svelte-ignore state_referenced_locally
    let context = $state(chapter.context);
    // svelte-ignore state_referenced_locally
    let outputDef = $state(chapter.outputDef);
    let successCriteria = $state("");
    // svelte-ignore state_referenced_locally
    let selectedToolIds = $state<string[]>([...chapterToolIds]);
    let aiLoading = $state(false);
    let aiError = $state<string | null>(null);
    let aiGenerated = $state(false);

    // ── Per-field AI wand state (AI-01) ─────────────────────────────────
    let fieldAiLoading = $state<Record<string, boolean>>({});
    let fieldAiGenerated = $state<Record<string, boolean>>({});

    type AiFieldName = 'description' | 'guide' | 'context' | 'outputDef';

    async function requestFieldAiFill(fieldName: AiFieldName) {
        fieldAiLoading = { ...fieldAiLoading, [fieldName]: true };
        try {
            const res = await fetch('/api/builder/ai/suggest-chapter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    description: description.trim(),
                    skillName,
                    skillDescription,
                    availableToolIds,
                    targetField: fieldName,
                }),
            });
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const data = await res.json();
            const aiValue = data[fieldName];
            if (!aiValue) return;
            const currentVal = getCurrentFieldValue(fieldName);
            if (currentVal.trim() && currentVal.trim() !== aiValue.trim()) {
                conflicts = { ...conflicts, [fieldName]: { userValue: currentVal, aiValue } };
            } else {
                setFieldValue(fieldName, aiValue);
                fieldAiGenerated = { ...fieldAiGenerated, [fieldName]: true };
            }
        } catch (err) {
            aiError = err instanceof Error ? err.message : 'AI fill failed';
        } finally {
            fieldAiLoading = { ...fieldAiLoading, [fieldName]: false };
        }
    }

    function clearFieldAiGenerated(fieldName: string) {
        if (fieldAiGenerated[fieldName]) {
            fieldAiGenerated = { ...fieldAiGenerated, [fieldName]: false };
        }
    }

    // ── Progressive disclosure ──────────────────────────────────────────
    let showAdvanced = $state(false);

    // Auto-expand if advanced fields have content
    $effect(() => {
        if (guide.trim() || context.trim() || outputDef.trim() || triggerConditions.trim() || successCriteria.trim()) {
            showAdvanced = true;
        }
    });

    // ── Conflict resolution state ────────────────────────────────────────
    let conflicts = $state<Partial<Record<FieldKey, FieldConflict>>>({});
    const totalConflicts = $derived(Object.keys(conflicts).length);

    // ── Parse existing data for trigger conditions + success criteria ──
    function initFromStoredData() {
        if (chapter.context.includes("\n---\n")) {
            const parts = chapter.context.split("\n---\n");
            triggerConditions = parts[0];
            context = parts.slice(1).join("\n---\n");
        }
        if (chapter.outputDef.includes("\n---\n")) {
            const parts = chapter.outputDef.split("\n---\n");
            outputDef = parts[0];
            successCriteria = parts.slice(1).join("\n---\n");
        }
    }
    initFromStoredData();

    const canAiFill = $derived(name.trim().length >= 3);

    // ── Field value helpers ──────────────────────────────────────────────
    function getCurrentFieldValue(key: FieldKey): string {
        switch (key) {
            case "name": return name;
            case "description": return description;
            case "triggerConditions": return triggerConditions;
            case "guide": return guide;
            case "context": return context;
            case "outputDef": return outputDef;
            case "successCriteria": return successCriteria;
        }
    }

    function setFieldValue(key: FieldKey, value: string) {
        switch (key) {
            case "name": name = value; break;
            case "description": description = value; break;
            case "triggerConditions": triggerConditions = value; break;
            case "guide": guide = value; break;
            case "context": context = value; break;
            case "outputDef": outputDef = value; break;
            case "successCriteria": successCriteria = value; break;
        }
    }

    // ── Conflict resolution ──────────────────────────────────────────────
    function resolveConflict(field: FieldKey, choice: "user" | "ai") {
        const conflict = conflicts[field];
        if (!conflict) return;
        if (choice === "ai") setFieldValue(field, conflict.aiValue);
        const next = { ...conflicts };
        delete next[field];
        conflicts = next;
    }

    // ── AI auto-fill ──────────────────────────────────────────────────────
    async function requestAiSuggestion() {
        aiLoading = true;
        aiError = null;

        try {
            const res = await fetch("/api/builder/ai/suggest-chapter", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(),
                    description: description.trim(),
                    skillName,
                    skillDescription,
                    availableToolIds,
                    includeStep1: true,
                }),
            });

            if (!res.ok) {
                const errBody = await res.text();
                throw new Error(errBody || `Request failed with status ${res.status}`);
            }

            const data = await res.json();

            const aiFields: [FieldKey, string | undefined][] = [
                ["name", data.name],
                ["description", data.description],
                ["triggerConditions", data.triggerConditions],
                ["guide", data.guide],
                ["context", data.context],
                ["outputDef", data.outputDef],
                ["successCriteria", data.successCriteria],
            ];

            let newConflicts = { ...conflicts };

            for (const [key, aiVal] of aiFields) {
                if (!aiVal) continue;
                const currentVal = getCurrentFieldValue(key);
                if (currentVal.trim() && currentVal.trim() !== aiVal.trim()) {
                    newConflicts[key] = { userValue: currentVal, aiValue: aiVal };
                } else {
                    setFieldValue(key, aiVal);
                }
            }

            conflicts = newConflicts;

            if (data.suggestedToolIds && Array.isArray(data.suggestedToolIds)) {
                selectedToolIds = data.suggestedToolIds.filter(
                    (id: string) => availableToolIds.includes(id),
                );
            }

            aiGenerated = true;
            showAdvanced = true;
        } catch (err) {
            aiError = err instanceof Error ? err.message : "Failed to generate suggestions";
        } finally {
            aiLoading = false;
        }
    }

    // ── Tool toggle ─────────────────────────────────────────────────────
    function toggleTool(toolId: string) {
        if (selectedToolIds.includes(toolId)) {
            selectedToolIds = selectedToolIds.filter((id) => id !== toolId);
        } else {
            selectedToolIds = [...selectedToolIds, toolId];
        }
    }

    // ── Actions ─────────────────────────────────────────────────────────
    function handleSave() {
        const combinedContext = triggerConditions.trim()
            ? `${triggerConditions.trim()}\n---\n${context.trim()}`
            : context.trim();

        const combinedOutputDef = successCriteria.trim()
            ? `${outputDef.trim()}\n---\n${successCriteria.trim()}`
            : outputDef.trim();

        onSave({
            name,
            description,
            guide,
            context: combinedContext,
            outputDef: combinedOutputDef,
            toolIds: selectedToolIds,
        });
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") onClose();
    }

    // ── Conflict snippet ────────────────────────────────────────────────
    function conflictSnippet(field: FieldKey): FieldConflict | undefined {
        return conflicts[field];
    }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Drawer (right side, no backdrop — sits inside the editor layout) -->
<aside class="chapter-drawer" role="dialog" aria-label="Edit Chapter: {name}">
    <!-- Header -->
    <div class="drawer-header">
        <span class="drawer-title">Edit Chapter</span>
        {#if totalConflicts > 0}
            <span class="conflict-note">
                <AlertCircle size={12} />
                {totalConflicts} conflict{totalConflicts !== 1 ? "s" : ""}
            </span>
        {/if}
        <span class="flex-1"></span>
        <button class="close-btn" onclick={onClose} aria-label="Close">
            <X size={16} />
        </button>
    </div>

    <!-- Scrollable body -->
    <div class="drawer-body">
        <!-- Name -->
        <div class="field">
            <label class="field-label" for="ch-name">Name <span class="required">*</span></label>
            <input id="ch-name" class="field-input" type="text" bind:value={name} placeholder="e.g. Research Phase" />
            {#if conflictSnippet('name')}
                {@render conflictBox('name')}
            {/if}
        </div>

        <!-- Description -->
        <div class="field">
            <div class="field-label-row">
                <label class="field-label" for="ch-desc">Description</label>
                <button class="ai-wand-btn" class:loading={fieldAiLoading['description']} onclick={() => requestFieldAiFill('description')} disabled={fieldAiLoading['description']} title="AI fill this field">
                    {#if fieldAiLoading['description']}<Loader2 size={12} class="spin" />{:else}<Sparkles size={12} />{/if}
                </button>
            </div>
            <textarea id="ch-desc" class="field-textarea" class:ai-generated={fieldAiGenerated['description']} rows="2" bind:value={description} oninput={() => clearFieldAiGenerated('description')} placeholder="What does this chapter accomplish?"></textarea>
            {#if conflictSnippet('description')}
                {@render conflictBox('description')}
            {/if}
        </div>

        <!-- AI Generate -->
        {#if canAiFill}
            <div class="ai-section">
                <button class="ai-btn" onclick={requestAiSuggestion} disabled={aiLoading}>
                    {#if aiLoading}
                        <Loader2 size={14} class="spin" />
                        Generating...
                    {:else}
                        <Sparkles size={14} />
                        AI fill all fields
                    {/if}
                </button>
                {#if aiError}
                    <span class="ai-error">{aiError}</span>
                {/if}
            </div>
        {/if}

        <!-- Tools -->
        <div class="field">
            <span class="field-label">Tools <span class="tool-count">{selectedToolIds.length}</span></span>
            {#if availableToolIds.length === 0}
                <div class="tools-empty">No tools available</div>
            {:else}
                <div class="tools-grid">
                    {#each availableToolIds as toolId (toolId)}
                        {@const tool = getToolInfo(toolId)}
                        {@const checked = selectedToolIds.includes(toolId)}
                        {@const isSuggested = !checked && suggestedToolIds.includes(toolId)}
                        <label class="tool-chip" class:checked class:suggested={isSuggested}>
                            <input type="checkbox" {checked} onchange={() => toggleTool(toolId)} />
                            <span class="tool-icon">{tool.icon}</span>
                            <span class="tool-name">{tool.name}</span>
                            {#if isSuggested}
                                <Sparkles size={10} class="suggested-sparkle" />
                            {/if}
                        </label>
                    {/each}
                </div>
            {/if}
        </div>

        <!-- Advanced fields (progressive disclosure) -->
        <button class="advanced-toggle" onclick={() => (showAdvanced = !showAdvanced)}>
            {#if showAdvanced}
                <ChevronDown size={14} />
            {:else}
                <ChevronRight size={14} />
            {/if}
            <span>Advanced fields</span>
            {#if !showAdvanced && (guide.trim() || context.trim() || outputDef.trim())}
                <span class="advanced-filled-dot"></span>
            {/if}
        </button>

        {#if showAdvanced}
            <div class="advanced-fields">
                <!-- Trigger Conditions -->
                <div class="field">
                    <label class="field-label" for="ch-trigger">Trigger Conditions</label>
                    <span class="field-helper">When should this chapter activate?</span>
                    <textarea id="ch-trigger" class="field-textarea" rows="2" bind:value={triggerConditions} placeholder="e.g. When upstream provides URLs"></textarea>
                    {#if conflictSnippet('triggerConditions')}
                        {@render conflictBox('triggerConditions')}
                    {/if}
                </div>

                <!-- Instructions (guide) -->
                <div class="field">
                    <div class="field-label-row">
                        <label class="field-label" for="ch-guide">Instructions</label>
                        <button class="ai-wand-btn" class:loading={fieldAiLoading['guide']} onclick={() => requestFieldAiFill('guide')} disabled={fieldAiLoading['guide']} title="AI fill this field">
                            {#if fieldAiLoading['guide']}<Loader2 size={12} class="spin" />{:else}<Sparkles size={12} />{/if}
                        </button>
                    </div>
                    <span class="field-helper">Imperative, verb-first instructions</span>
                    {#if aiGenerated && !conflicts.guide}
                        <span class="ai-label">(AI-generated — review and edit)</span>
                    {/if}
                    <textarea id="ch-guide" class="field-textarea field-textarea--mono" class:ai-generated={fieldAiGenerated['guide']} rows="6" bind:value={guide} oninput={() => clearFieldAiGenerated('guide')} placeholder="Search the web for..., Extract key data..."></textarea>
                    {#if conflictSnippet('guide')}
                        {@render conflictBox('guide')}
                    {/if}
                </div>

                <!-- Input Expectations (context) -->
                <div class="field">
                    <div class="field-label-row">
                        <label class="field-label" for="ch-context">Input Expectations</label>
                        <button class="ai-wand-btn" class:loading={fieldAiLoading['context']} onclick={() => requestFieldAiFill('context')} disabled={fieldAiLoading['context']} title="AI fill this field">
                            {#if fieldAiLoading['context']}<Loader2 size={12} class="spin" />{:else}<Sparkles size={12} />{/if}
                        </button>
                    </div>
                    <span class="field-helper">What data does this chapter receive?</span>
                    {#if aiGenerated && !conflicts.context}
                        <span class="ai-label">(AI-generated)</span>
                    {/if}
                    <textarea id="ch-context" class="field-textarea" class:ai-generated={fieldAiGenerated['context']} rows="2" bind:value={context} oninput={() => clearFieldAiGenerated('context')} placeholder="e.g. Array of search results"></textarea>
                    {#if conflictSnippet('context')}
                        {@render conflictBox('context')}
                    {/if}
                </div>

                <!-- Output Definition -->
                <div class="field">
                    <div class="field-label-row">
                        <label class="field-label" for="ch-output">Output Definition</label>
                        <button class="ai-wand-btn" class:loading={fieldAiLoading['outputDef']} onclick={() => requestFieldAiFill('outputDef')} disabled={fieldAiLoading['outputDef']} title="AI fill this field">
                            {#if fieldAiLoading['outputDef']}<Loader2 size={12} class="spin" />{:else}<Sparkles size={12} />{/if}
                        </button>
                    </div>
                    <span class="field-helper">What does this chapter produce?</span>
                    {#if aiGenerated && !conflicts.outputDef}
                        <span class="ai-label">(AI-generated)</span>
                    {/if}
                    <textarea id="ch-output" class="field-textarea" class:ai-generated={fieldAiGenerated['outputDef']} rows="2" bind:value={outputDef} oninput={() => clearFieldAiGenerated('outputDef')} placeholder="e.g. Structured JSON, Summary markdown"></textarea>
                    {#if conflictSnippet('outputDef')}
                        {@render conflictBox('outputDef')}
                    {/if}
                </div>

                <!-- Success Criteria -->
                <div class="field">
                    <label class="field-label" for="ch-success">Success Criteria</label>
                    <span class="field-helper">What must be true when this completes?</span>
                    <textarea id="ch-success" class="field-textarea" rows="2" bind:value={successCriteria} placeholder="e.g. All URLs fetched, Output has 3+ data points"></textarea>
                    {#if conflictSnippet('successCriteria')}
                        {@render conflictBox('successCriteria')}
                    {/if}
                </div>
            </div>
        {/if}
    </div>

    <!-- Footer -->
    <div class="drawer-footer">
        <button class="btn btn--ghost" onclick={onClose}>Cancel</button>
        <button class="btn btn--primary" onclick={handleSave} disabled={totalConflicts > 0}>
            <Check size={14} />
            Save
        </button>
    </div>
</aside>

{#snippet conflictBox(field: FieldKey)}
    {@const c = conflicts[field]}
    {#if c}
        <div class="conflict-box">
            <div class="conflict-header">
                <Sparkles size={12} />
                <span>AI suggested a different value</span>
            </div>
            <div class="conflict-options">
                <button class="conflict-opt mine" onclick={() => resolveConflict(field, 'user')}>Keep yours</button>
                <button class="conflict-opt ai" onclick={() => resolveConflict(field, 'ai')}>Use AI</button>
            </div>
            <div class="conflict-preview">{c.aiValue.slice(0, 120)}{c.aiValue.length > 120 ? '...' : ''}</div>
        </div>
    {/if}
{/snippet}

<style>
    /* ── Drawer ──────────────────────────────────────────────────────────── */
    .chapter-drawer {
        width: 380px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        height: 100%;
        border-left: 1px solid var(--color-border);
        background: var(--color-bg);
        animation: slide-in 0.15s ease-out;
    }

    @keyframes slide-in {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }

    .drawer-header {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 2.75rem;
        padding: 0 16px;
        background: var(--color-bg2);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .drawer-title {
        font-size: 14px;
        font-weight: 700;
        color: var(--color-foreground);
    }

    .conflict-note {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 600;
        color: var(--color-warning, #f59e0b);
    }

    .flex-1 { flex: 1; }

    .close-btn {
        background: transparent;
        border: none;
        color: var(--color-muted);
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.15s;
        flex-shrink: 0;
    }
    .close-btn:hover { color: var(--color-foreground); }

    /* ── Body ────────────────────────────────────────────────────────────── */
    .drawer-body {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    /* ── Form fields ─────────────────────────────────────────────────────── */
    .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .field-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--color-foreground);
    }

    .required { color: var(--color-accent); }

    .field-helper {
        font-size: 11px;
        color: var(--color-muted);
    }

    .field-input {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-foreground);
        font-family: inherit;
        font-size: 13px;
        padding: 8px 10px;
        outline: none;
        transition: border-color 0.15s, box-shadow 0.15s;
    }
    .field-input:focus {
        border-color: var(--color-accent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
    }
    .field-input::placeholder { color: var(--color-muted); }

    .field-textarea {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        color: var(--color-foreground);
        font-family: inherit;
        font-size: 13px;
        padding: 8px 10px;
        outline: none;
        resize: vertical;
        transition: border-color 0.15s, box-shadow 0.15s;
    }
    .field-textarea:focus {
        border-color: var(--color-accent);
        box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-accent) 20%, transparent);
    }
    .field-textarea::placeholder { color: var(--color-muted); }

    .field-textarea--mono {
        font-family: "JetBrains Mono", "Fira Code", monospace;
        font-size: 12px;
    }

    /* ── Field label row with wand ────────────────────────────────────────── */
    .field-label-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
    }

    .ai-wand-btn {
        display: none;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        background: transparent;
        border: 1px solid transparent;
        border-radius: 4px;
        color: var(--color-accent);
        cursor: pointer;
        transition: all 0.15s;
        flex-shrink: 0;
    }
    .field:hover .ai-wand-btn,
    .ai-wand-btn.loading {
        display: inline-flex;
    }
    .ai-wand-btn:hover:not(:disabled) {
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
        border-color: color-mix(in srgb, var(--color-accent) 25%, transparent);
    }
    .ai-wand-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .field-textarea.ai-generated {
        opacity: 0.85;
        font-style: italic;
    }

    /* ── AI section ──────────────────────────────────────────────────────── */
    .ai-section {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .ai-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        background: var(--color-accent);
        color: white;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        padding: 7px 14px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: filter 0.15s, opacity 0.15s;
        align-self: flex-start;
    }
    .ai-btn:hover:not(:disabled) { filter: brightness(1.15); }
    .ai-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .ai-error { font-size: 11px; color: #ef4444; }

    .ai-label {
        font-size: 11px;
        font-style: italic;
        color: var(--color-muted);
    }

    /* ── Tools ────────────────────────────────────────────────────────────── */
    .tool-count {
        font-size: 10px;
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: 1px 6px;
        border-radius: 9999px;
        margin-left: 4px;
        font-weight: 500;
    }

    .tools-empty {
        padding: 12px;
        text-align: center;
        color: var(--color-muted);
        font-size: 12px;
        background: var(--color-bg2);
        border: 1px dashed var(--color-border);
        border-radius: 6px;
    }

    .tools-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .tool-chip {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        cursor: pointer;
        font-size: 11px;
        transition: all 0.15s;
    }
    .tool-chip:hover { border-color: var(--color-accent); }
    .tool-chip.checked {
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 8%, var(--color-bg2));
    }
    .tool-chip input[type="checkbox"] { display: none; }

    .tool-icon { font-size: 14px; }
    .tool-name {
        color: var(--color-foreground);
        font-weight: 500;
    }
    .tool-chip:not(.checked) .tool-name { color: var(--color-muted); }
    .tool-chip.suggested {
        border-color: color-mix(in srgb, var(--color-accent) 30%, var(--color-border));
        background: color-mix(in srgb, var(--color-accent) 4%, var(--color-bg2));
        border-style: dashed;
    }
    :global(.suggested-sparkle) { color: var(--color-accent); opacity: 0.7; }

    /* ── Advanced toggle ─────────────────────────────────────────────────── */
    .advanced-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        background: transparent;
        border: none;
        border-top: 1px solid var(--color-border);
        color: var(--color-muted);
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        padding: 10px 0 0;
        cursor: pointer;
        transition: color 0.15s;
    }
    .advanced-toggle:hover { color: var(--color-foreground); }

    .advanced-filled-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--color-accent);
    }

    .advanced-fields {
        display: flex;
        flex-direction: column;
        gap: 14px;
        padding-top: 4px;
    }

    /* ── Conflict resolution ──────────────────────────────────────────────── */
    .conflict-box {
        border: 1px solid color-mix(in srgb, var(--color-accent) 30%, var(--color-border));
        border-radius: 6px;
        padding: 8px 10px;
        background: color-mix(in srgb, var(--color-accent) 4%, var(--color-bg));
        margin-top: 4px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .conflict-header {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 600;
        color: var(--color-accent);
    }

    .conflict-options { display: flex; gap: 6px; }

    .conflict-opt {
        font-family: inherit;
        font-size: 11px;
        font-weight: 600;
        padding: 4px 10px;
        border-radius: 4px;
        cursor: pointer;
        border: 1px solid var(--color-border);
        background: var(--color-bg2);
        color: var(--color-foreground);
        transition: all 0.15s;
    }
    .conflict-opt.mine:hover { border-color: var(--color-foreground); }
    .conflict-opt.ai {
        background: var(--color-accent);
        border-color: var(--color-accent);
        color: white;
    }
    .conflict-opt.ai:hover { filter: brightness(1.15); }

    .conflict-preview {
        font-size: 11px;
        color: var(--color-muted);
        font-style: italic;
        line-height: 1.3;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
    }

    /* ── Footer ──────────────────────────────────────────────────────────── */
    .drawer-footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        padding: 10px 16px;
        border-top: 1px solid var(--color-border);
        background: var(--color-bg2);
        flex-shrink: 0;
    }

    .btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        padding: 6px 14px;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s;
        border: none;
    }

    .btn--ghost {
        background: transparent;
        border: 1px solid var(--color-border);
        color: var(--color-muted);
    }
    .btn--ghost:hover { color: var(--color-foreground); border-color: var(--color-foreground); }

    .btn--primary {
        background: var(--color-accent);
        color: white;
    }
    .btn--primary:hover:not(:disabled) { filter: brightness(1.15); }
    .btn--primary:disabled { opacity: 0.5; cursor: not-allowed; }

    :global(.spin) {
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
</style>
