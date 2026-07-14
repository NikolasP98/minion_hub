<script lang="ts">
  import { Button } from '$lib/components/ui';
import { autosize } from '$lib/actions/autosize';
    import { Sparkles, Loader2, ChevronDown, ChevronRight } from "lucide-svelte";
    import * as m from '$lib/paraglide/messages';
    import AiWandButton from './_chapter-editor/AiWandButton.svelte';
    import ConflictBox from './_chapter-editor/ConflictBox.svelte';
    import ToolsPanel from './_chapter-editor/ToolsPanel.svelte';
    import AdvancedFields from './_chapter-editor/AdvancedFields.svelte';
    import DrawerHeader from './_chapter-editor/DrawerHeader.svelte';
    import DrawerFooter from './_chapter-editor/DrawerFooter.svelte';
    import type { FieldKey, FieldConflict, ChapterData, AiFieldName } from './_chapter-editor/types';

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

    // ── Per-field AI wand state ─────────────────────────────────────────
    let fieldAiLoading = $state<Record<string, boolean>>({});
    let fieldAiGenerated = $state<Record<string, boolean>>({});

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
            aiError = err instanceof Error ? err.message : m.builder_failedGenerateSuggestions();
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
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Drawer (right side, no backdrop — sits inside the editor layout) -->
<div class="chapter-drawer" role="dialog" tabindex="-1" aria-label="{m.builder_editChapterLabel({ name })}">
    <DrawerHeader {totalConflicts} {onClose} />

    <!-- Scrollable body -->
    <div class="drawer-body">
        <!-- Name -->
        <div class="field">
            <label class="field-label" for="ch-name">{m.agent_name()} <span class="required">*</span></label>
            <input id="ch-name" class="field-input" type="text" bind:value={name} placeholder={m.builder_chapterNamePlaceholder()} />
            {#if conflicts.name}
                <ConflictBox field="name" conflict={conflicts.name} onResolve={resolveConflict} />
            {/if}
        </div>

        <!-- Description -->
        <div class="field">
            <div class="field-label-row">
                <label class="field-label" for="ch-desc">{m.builder_description()}</label>
                <AiWandButton loading={!!fieldAiLoading['description']} onclick={() => requestFieldAiFill('description')} />
            </div>
            <textarea id="ch-desc" class="field-textarea" class:ai-generated={fieldAiGenerated['description']} use:autosize={description} bind:value={description} oninput={() => clearFieldAiGenerated('description')} placeholder={m.builder_chapterDescPlaceholder()}></textarea>
            {#if conflicts.description}
                <ConflictBox field="description" conflict={conflicts.description} onResolve={resolveConflict} />
            {/if}
        </div>

        <!-- AI Generate -->
        {#if canAiFill}
            <div class="ai-section">
                <Button variant="ghost" class="ai-btn" onclick={requestAiSuggestion} disabled={aiLoading}>
                    {#if aiLoading}
                        <Loader2 size={14} class="spin" />
                        {m.builder_generating()}
                    {:else}
                        <Sparkles size={14} />
                        {m.builder_aiFillAll()}
                    {/if}
                </Button>
                {#if aiError}
                    <span class="ai-error">{aiError}</span>
                {/if}
            </div>
        {/if}

        <!-- Tools -->
        <ToolsPanel
            {availableToolIds}
            {selectedToolIds}
            {suggestedToolIds}
            onToggle={toggleTool}
        />

        <!-- Advanced fields (progressive disclosure) -->
        <Button variant="ghost" class="advanced-toggle" onclick={() => (showAdvanced = !showAdvanced)}>
            {#if showAdvanced}
                <ChevronDown size={14} />
            {:else}
                <ChevronRight size={14} />
            {/if}
            <span>{m.builder_advancedFields()}</span>
            {#if !showAdvanced && (guide.trim() || context.trim() || outputDef.trim())}
                <span class="advanced-filled-dot"></span>
            {/if}
        </Button>

        {#if showAdvanced}
            <AdvancedFields
                bind:triggerConditions
                bind:guide
                bind:context
                bind:outputDef
                bind:successCriteria
                {conflicts}
                {aiGenerated}
                {fieldAiLoading}
                {fieldAiGenerated}
                onFieldAiFill={requestFieldAiFill}
                onClearFieldAiGenerated={clearFieldAiGenerated}
                onResolveConflict={resolveConflict}
            />
        {/if}
    </div>

    <DrawerFooter {totalConflicts} {onClose} onSave={handleSave} />
</div>

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

    /* ── Body ────────────────────────────────────────────────────────────── */
    .drawer-body {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-4);
        display: flex;
        flex-direction: column;
        gap: var(--space-3);
    }

    /* ── Form fields ─────────────────────────────────────────────────────── */
    .field {
        display: flex;
        flex-direction: column;
        gap: var(--space-1);
    }

    .field-label {
        font-size: var(--font-size-caption);
        font-weight: 600;
        color: var(--color-foreground);
    }

    .required { color: var(--color-accent); }

    .field-input {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-foreground);
        font-family: inherit;
        font-size: var(--font-size-body);
        padding: var(--space-2) var(--space-2);
        outline: none;
        transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
    }
    .field-input:focus {
        border-color: var(--color-accent);
        box-shadow: var(--shadow-elevation-1);
    }
    .field-input::placeholder { color: var(--color-muted); }

    .field-textarea {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        color: var(--color-foreground);
        font-family: inherit;
        font-size: var(--font-size-body);
        padding: var(--space-2) var(--space-2);
        outline: none;
        resize: vertical;
        transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
    }
    .field-textarea:focus {
        border-color: var(--color-accent);
        box-shadow: var(--shadow-elevation-1);
    }
    .field-textarea::placeholder { color: var(--color-muted); }

    /* ── Field label row with wand ────────────────────────────────────────── */
    .field-label-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-1);
    }

    /* AI wand button — :global because <AiWandButton> is a child component
       but uses parent's .field:hover for show/hide. */
    :global(.ai-wand-btn) {
        display: none;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        background: transparent;
        border: 1px solid transparent;
        border-radius: var(--radius-sm);
        color: var(--color-accent);
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-standard);
        flex-shrink: 0;
    }
    .field:hover :global(.ai-wand-btn),
    :global(.ai-wand-btn.loading) {
        display: inline-flex;
    }
    :global(.ai-wand-btn:hover:not(:disabled)) {
        background: color-mix(in srgb, var(--color-accent) 10%, transparent);
        border-color: color-mix(in srgb, var(--color-accent) 25%, transparent);
    }
    :global(.ai-wand-btn:disabled) { opacity: 0.5; cursor: not-allowed; }

    .field-textarea.ai-generated {
        opacity: 0.85;
        font-style: italic;
    }

    /* ── AI section ──────────────────────────────────────────────────────── */
    .ai-section {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .ai-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        background: var(--color-accent);
        color: white;
        font-family: inherit;
        font-size: var(--font-size-caption);
        font-weight: 600;
        padding: var(--space-2) var(--space-3);
        border: none;
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: filter var(--duration-fast), opacity var(--duration-fast);
        align-self: flex-start;
    }
    .ai-btn:hover:not(:disabled) { filter: brightness(1.15); }
    .ai-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .ai-error { font-size: var(--font-size-caption); color: var(--color-danger-fg); }

    :global(.suggested-sparkle) { color: var(--color-accent); opacity: 0.7; }

    /* ── Advanced toggle ─────────────────────────────────────────────────── */
    .advanced-toggle {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        background: transparent;
        border: none;
        border-top: 1px solid var(--color-border);
        color: var(--color-muted);
        font-family: inherit;
        font-size: var(--font-size-caption);
        font-weight: 600;
        padding: var(--space-2) 0 0;
        cursor: pointer;
        transition: color var(--duration-fast);
    }
    .advanced-toggle:hover { color: var(--color-foreground); }

    .advanced-filled-dot {
        width: 6px;
        height: 6px;
        border-radius: var(--radius-full);
        background: var(--color-accent);
    }

    :global(.spin) {
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }
</style>
