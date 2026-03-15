<script lang="ts">
    import {
        X,
        ChevronLeft,
        ChevronRight,
        Check,
        Sparkles,
        Loader2,
        AlertCircle,
    } from "lucide-svelte";
    import * as steps from "@zag-js/steps";
    import { useMachine, normalizeProps } from "@zag-js/svelte";
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
        skillName,
        skillDescription,
        onSave,
        onClose,
    }: Props = $props();

    // ── Local form state (one-time init from props — modal is destroyed on close) ──
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

    // ── Conflict resolution state ────────────────────────────────────────────
    let conflicts = $state<Partial<Record<FieldKey, FieldConflict>>>({});

    const step0ConflictFields: FieldKey[] = [
        "name",
        "description",
        "triggerConditions",
    ];
    const step1ConflictFields: FieldKey[] = ["guide"];
    const step3ConflictFields: FieldKey[] = [
        "context",
        "outputDef",
        "successCriteria",
    ];

    const step0Conflicts = $derived(
        step0ConflictFields.filter((k) => conflicts[k]).length,
    );
    const step1Conflicts = $derived(
        step1ConflictFields.filter((k) => conflicts[k]).length,
    );
    const step3Conflicts = $derived(
        step3ConflictFields.filter((k) => conflicts[k]).length,
    );
    const totalConflicts = $derived(
        step0Conflicts + step1Conflicts + step3Conflicts,
    );

    function conflictsForStep(stepIdx: number): number {
        if (stepIdx === 0) return step0Conflicts;
        if (stepIdx === 1) return step1Conflicts;
        if (stepIdx === 3) return step3Conflicts;
        return 0;
    }

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

    // ── Zag.js steps machine ────────────────────────────────────────────────
    const STEP_COUNT = 4;
    const stepsData = [
        { title: "Purpose" },
        { title: "Instructions" },
        { title: "Tools" },
        { title: "Data Flow" },
    ];

    const service = useMachine(steps.machine, () => ({
        id: "chapter-editor",
        count: stepsData.length,
    }));
    const api = $derived(steps.connect(service, normalizeProps));

    const isLastStep = $derived(api.value === STEP_COUNT - 1);
    const canAiFill = $derived(name.trim().length >= 3);
    const currentStepHasConflicts = $derived(conflictsForStep(api.value) > 0);

    // ── Field value helpers ──────────────────────────────────────────────────
    function getCurrentFieldValue(key: FieldKey): string {
        switch (key) {
            case "name":
                return name;
            case "description":
                return description;
            case "triggerConditions":
                return triggerConditions;
            case "guide":
                return guide;
            case "context":
                return context;
            case "outputDef":
                return outputDef;
            case "successCriteria":
                return successCriteria;
        }
    }

    function setFieldValue(key: FieldKey, value: string) {
        switch (key) {
            case "name":
                name = value;
                break;
            case "description":
                description = value;
                break;
            case "triggerConditions":
                triggerConditions = value;
                break;
            case "guide":
                guide = value;
                break;
            case "context":
                context = value;
                break;
            case "outputDef":
                outputDef = value;
                break;
            case "successCriteria":
                successCriteria = value;
                break;
        }
    }

    // ── Conflict resolution ──────────────────────────────────────────────────
    function resolveConflict(field: FieldKey, choice: "user" | "ai") {
        const conflict = conflicts[field];
        if (!conflict) return;
        if (choice === "ai") {
            setFieldValue(field, conflict.aiValue);
        }
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
                throw new Error(
                    errBody || `Request failed with status ${res.status}`,
                );
            }

            const data = await res.json();

            // Process each AI-suggested field for conflicts
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
                if (
                    currentVal.trim() &&
                    currentVal.trim() !== aiVal.trim()
                ) {
                    newConflicts[key] = {
                        userValue: currentVal,
                        aiValue: aiVal,
                    };
                } else {
                    setFieldValue(key, aiVal);
                }
            }

            conflicts = newConflicts;

            // Tools are additive — just pre-check without conflicts
            if (
                data.suggestedToolIds &&
                Array.isArray(data.suggestedToolIds)
            ) {
                selectedToolIds = data.suggestedToolIds.filter(
                    (id: string) => availableToolIds.includes(id),
                );
            }

            aiGenerated = true;
        } catch (err) {
            aiError =
                err instanceof Error
                    ? err.message
                    : "Failed to generate suggestions";
        } finally {
            aiLoading = false;
        }
    }

    // ── Tool toggle ─────────────────────────────────────────────────────────
    function toggleTool(toolId: string) {
        if (selectedToolIds.includes(toolId)) {
            selectedToolIds = selectedToolIds.filter((id) => id !== toolId);
        } else {
            selectedToolIds = [...selectedToolIds, toolId];
        }
    }

    // ── Actions ─────────────────────────────────────────────────────────────
    function handleSave() {
        // Combine trigger conditions into context
        const combinedContext = triggerConditions.trim()
            ? `${triggerConditions.trim()}\n---\n${context.trim()}`
            : context.trim();

        // Combine success criteria into outputDef
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

    function handleNextOrSave() {
        if (isLastStep) {
            handleSave();
        } else {
            api.goToNextStep();
        }
    }

    function handleOverlayClick(e: MouseEvent) {
        if (e.target === e.currentTarget) onClose();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") onClose();
    }
</script>

<div
    class="overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Edit Chapter"
    tabindex="-1"
    onclick={handleOverlayClick}
    onkeydown={handleKeydown}
>
    <div class="modal">
        <!-- Header -->
        <div class="modal-header">
            <span class="modal-title">Edit Chapter</span>
            {#if totalConflicts > 0}
                <span class="header-conflict-note">
                    <AlertCircle size={12} />
                    {totalConflicts} conflict{totalConflicts !== 1 ? "s" : ""} to resolve
                </span>
            {/if}
            <button
                class="close-btn"
                onclick={onClose}
                aria-label="Close"
            >
                <X size={16} />
            </button>
        </div>

        <!-- Step indicator -->
        <div class="steps-root" {...api.getRootProps()}>
            <div class="steps-list" {...api.getListProps()}>
                {#each stepsData as stepData, index (index)}
                    <div class="step-item" {...api.getItemProps({ index })}>
                        <button
                            class="step-trigger"
                            {...api.getTriggerProps({ index })}
                        >
                            <span
                                class="step-indicator-wrap"
                            >
                                <span
                                    class="step-indicator"
                                    {...api.getIndicatorProps({ index })}
                                >
                                    {#if api.getItemState({ index }).completed}
                                        <Check size={12} />
                                    {:else}
                                        {index + 1}
                                    {/if}
                                </span>
                                {#if conflictsForStep(index) > 0}
                                    <span class="step-conflict-badge">
                                        {conflictsForStep(index)}
                                    </span>
                                {/if}
                            </span>
                            <span class="step-label">{stepData.title}</span>
                        </button>
                        {#if index < STEP_COUNT - 1}
                            <div
                                class="step-separator"
                                {...api.getSeparatorProps({ index })}
                            ></div>
                        {/if}
                    </div>
                {/each}
            </div>

            <!-- Step content -->
            <div class="step-content-area">
                <!-- Step 0: Purpose -->
                <div {...api.getContentProps({ index: 0 })}>
                    <div class="field">
                        <label class="field-label" for="chapter-name"
                            >Name <span class="required">*</span></label
                        >
                        <input
                            id="chapter-name"
                            class="field-input"
                            type="text"
                            bind:value={name}
                            placeholder="e.g. Research Phase, Data Extraction, Report Generation"
                            required
                        />
                        {#if conflicts.name}
                            <div class="conflict-box">
                                <div class="conflict-header">
                                    <Sparkles size={12} />
                                    <span>AI suggested a different value</span>
                                </div>
                                <div class="conflict-options">
                                    <button class="conflict-opt mine" onclick={() => resolveConflict('name', 'user')}>
                                        Keep yours
                                    </button>
                                    <button class="conflict-opt ai" onclick={() => resolveConflict('name', 'ai')}>
                                        Use AI
                                    </button>
                                </div>
                                <div class="conflict-preview">{conflicts.name.aiValue.slice(0, 120)}{conflicts.name.aiValue.length > 120 ? '...' : ''}</div>
                            </div>
                        {/if}
                    </div>
                    <div class="field">
                        <label class="field-label" for="chapter-desc"
                            >Description</label
                        >
                        <textarea
                            id="chapter-desc"
                            class="field-textarea"
                            rows="3"
                            bind:value={description}
                            placeholder="What does this subprocess accomplish? Be specific about its role in the skill pipeline."
                        ></textarea>
                        {#if conflicts.description}
                            <div class="conflict-box">
                                <div class="conflict-header">
                                    <Sparkles size={12} />
                                    <span>AI suggested a different value</span>
                                </div>
                                <div class="conflict-options">
                                    <button class="conflict-opt mine" onclick={() => resolveConflict('description', 'user')}>
                                        Keep yours
                                    </button>
                                    <button class="conflict-opt ai" onclick={() => resolveConflict('description', 'ai')}>
                                        Use AI
                                    </button>
                                </div>
                                <div class="conflict-preview">{conflicts.description.aiValue.slice(0, 120)}{conflicts.description.aiValue.length > 120 ? '...' : ''}</div>
                            </div>
                        {/if}
                    </div>
                    <div class="field">
                        <label class="field-label" for="chapter-trigger"
                            >Trigger Conditions</label
                        >
                        <span class="field-helper"
                            >When should this subprocess activate?</span
                        >
                        <textarea
                            id="chapter-trigger"
                            class="field-textarea"
                            rows="2"
                            bind:value={triggerConditions}
                            placeholder="e.g. When upstream provides a list of URLs, After user confirms the research topic"
                        ></textarea>
                        {#if conflicts.triggerConditions}
                            <div class="conflict-box">
                                <div class="conflict-header">
                                    <Sparkles size={12} />
                                    <span>AI suggested a different value</span>
                                </div>
                                <div class="conflict-options">
                                    <button class="conflict-opt mine" onclick={() => resolveConflict('triggerConditions', 'user')}>
                                        Keep yours
                                    </button>
                                    <button class="conflict-opt ai" onclick={() => resolveConflict('triggerConditions', 'ai')}>
                                        Use AI
                                    </button>
                                </div>
                                <div class="conflict-preview">{conflicts.triggerConditions.aiValue.slice(0, 120)}{conflicts.triggerConditions.aiValue.length > 120 ? '...' : ''}</div>
                            </div>
                        {/if}
                    </div>

                    <!-- AI Generate Button -->
                    {#if canAiFill}
                        <div class="ai-section">
                            <button
                                class="ai-btn"
                                onclick={requestAiSuggestion}
                                disabled={aiLoading}
                            >
                                {#if aiLoading}
                                    <Loader2 size={14} class="spin" />
                                    Generating...
                                {:else}
                                    <Sparkles size={14} />
                                    Generate AI suggestions
                                {/if}
                            </button>
                            {#if aiError}
                                <span class="ai-error">{aiError}</span>
                            {/if}
                        </div>
                    {/if}
                </div>

                <!-- Step 1: Instructions -->
                <div {...api.getContentProps({ index: 1 })}>
                    <div class="ai-tip">
                        Write in imperative form: "Search for X" not "You
                        should search for X"
                    </div>
                    <div class="field">
                        <label class="field-label" for="chapter-guide"
                            >Instructions</label
                        >
                        <span class="field-helper"
                            >Write imperative, verb-first instructions for
                            this subprocess. Example: "Search the web
                            for...", "Extract key data points from...",
                            "Validate the output against..."</span
                        >
                        {#if aiGenerated && !conflicts.guide}
                            <span class="ai-label"
                                >(AI-generated — review and edit)</span
                            >
                        {/if}
                        <textarea
                            id="chapter-guide"
                            class="field-textarea field-textarea--mono"
                            rows="10"
                            bind:value={guide}
                            placeholder="Describe the step-by-step instructions for this chapter..."
                        ></textarea>
                        {#if conflicts.guide}
                            <div class="conflict-box">
                                <div class="conflict-header">
                                    <Sparkles size={12} />
                                    <span>AI suggested a different value</span>
                                </div>
                                <div class="conflict-options">
                                    <button class="conflict-opt mine" onclick={() => resolveConflict('guide', 'user')}>
                                        Keep yours
                                    </button>
                                    <button class="conflict-opt ai" onclick={() => resolveConflict('guide', 'ai')}>
                                        Use AI
                                    </button>
                                </div>
                                <div class="conflict-preview">{conflicts.guide.aiValue.slice(0, 120)}{conflicts.guide.aiValue.length > 120 ? '...' : ''}</div>
                            </div>
                        {/if}
                    </div>
                </div>

                <!-- Step 2: Tools -->
                <div {...api.getContentProps({ index: 2 })}>
                    <div class="field">
                        <span class="field-label">Tools</span>
                        <span class="field-helper"
                            >Select which tools this chapter can use</span
                        >
                        {#if availableToolIds.length === 0}
                            <div class="tools-empty">
                                No tools available. Connect to a gateway to
                                load tools.
                            </div>
                        {:else}
                            <div class="tools-grid">
                                {#each availableToolIds as toolId (toolId)}
                                    {@const tool = getToolInfo(toolId)}
                                    {@const checked =
                                        selectedToolIds.includes(toolId)}
                                    <label
                                        class="tool-checkbox"
                                        class:checked
                                    >
                                        <input
                                            type="checkbox"
                                            {checked}
                                            onchange={() =>
                                                toggleTool(toolId)}
                                        />
                                        <span class="tool-icon"
                                            >{tool.icon}</span
                                        >
                                        <span class="tool-info">
                                            <span class="tool-name"
                                                >{tool.name}</span
                                            >
                                            <span class="tool-desc"
                                                >{tool.description}</span
                                            >
                                        </span>
                                    </label>
                                {/each}
                            </div>
                        {/if}
                    </div>
                </div>

                <!-- Step 3: Data Flow -->
                <div {...api.getContentProps({ index: 3 })}>
                    <div class="field">
                        <label class="field-label" for="chapter-context"
                            >Input Expectations</label
                        >
                        <span class="field-helper"
                            >What data does this subprocess receive?</span
                        >
                        {#if aiGenerated && !conflicts.context}
                            <span class="ai-label"
                                >(AI-generated — review and edit)</span
                            >
                        {/if}
                        <textarea
                            id="chapter-context"
                            class="field-textarea"
                            rows="3"
                            bind:value={context}
                            placeholder="e.g. Array of search results from Research phase, User query string, Configuration parameters"
                        ></textarea>
                        {#if conflicts.context}
                            <div class="conflict-box">
                                <div class="conflict-header">
                                    <Sparkles size={12} />
                                    <span>AI suggested a different value</span>
                                </div>
                                <div class="conflict-options">
                                    <button class="conflict-opt mine" onclick={() => resolveConflict('context', 'user')}>
                                        Keep yours
                                    </button>
                                    <button class="conflict-opt ai" onclick={() => resolveConflict('context', 'ai')}>
                                        Use AI
                                    </button>
                                </div>
                                <div class="conflict-preview">{conflicts.context.aiValue.slice(0, 120)}{conflicts.context.aiValue.length > 120 ? '...' : ''}</div>
                            </div>
                        {/if}
                    </div>
                    <div class="field">
                        <label class="field-label" for="chapter-output"
                            >Output Definition</label
                        >
                        <span class="field-helper"
                            >What does this subprocess produce?</span
                        >
                        {#if aiGenerated && !conflicts.outputDef}
                            <span class="ai-label"
                                >(AI-generated — review and edit)</span
                            >
                        {/if}
                        <textarea
                            id="chapter-output"
                            class="field-textarea"
                            rows="3"
                            bind:value={outputDef}
                            placeholder="e.g. Structured JSON with extracted entities, Summary markdown document, Validated dataset"
                        ></textarea>
                        {#if conflicts.outputDef}
                            <div class="conflict-box">
                                <div class="conflict-header">
                                    <Sparkles size={12} />
                                    <span>AI suggested a different value</span>
                                </div>
                                <div class="conflict-options">
                                    <button class="conflict-opt mine" onclick={() => resolveConflict('outputDef', 'user')}>
                                        Keep yours
                                    </button>
                                    <button class="conflict-opt ai" onclick={() => resolveConflict('outputDef', 'ai')}>
                                        Use AI
                                    </button>
                                </div>
                                <div class="conflict-preview">{conflicts.outputDef.aiValue.slice(0, 120)}{conflicts.outputDef.aiValue.length > 120 ? '...' : ''}</div>
                            </div>
                        {/if}
                    </div>
                    <div class="field">
                        <label class="field-label" for="chapter-success"
                            >Success Criteria</label
                        >
                        <span class="field-helper"
                            >What must be true when this step completes?</span
                        >
                        <textarea
                            id="chapter-success"
                            class="field-textarea"
                            rows="2"
                            bind:value={successCriteria}
                            placeholder="e.g. All URLs have been fetched, Output contains at least 3 data points"
                        ></textarea>
                        {#if conflicts.successCriteria}
                            <div class="conflict-box">
                                <div class="conflict-header">
                                    <Sparkles size={12} />
                                    <span>AI suggested a different value</span>
                                </div>
                                <div class="conflict-options">
                                    <button class="conflict-opt mine" onclick={() => resolveConflict('successCriteria', 'user')}>
                                        Keep yours
                                    </button>
                                    <button class="conflict-opt ai" onclick={() => resolveConflict('successCriteria', 'ai')}>
                                        Use AI
                                    </button>
                                </div>
                                <div class="conflict-preview">{conflicts.successCriteria.aiValue.slice(0, 120)}{conflicts.successCriteria.aiValue.length > 120 ? '...' : ''}</div>
                            </div>
                        {/if}
                    </div>
                </div>
            </div>
        </div>

        <!-- Footer -->
        <div class="modal-footer">
            <div class="footer-left">
                {#if api.hasPrevStep}
                    <button
                        class="btn btn--ghost"
                        {...api.getPrevTriggerProps()}
                    >
                        <ChevronLeft size={14} />
                        Back
                    </button>
                {/if}
            </div>

            <span class="step-counter">
                Step {api.value + 1} of {STEP_COUNT}
            </span>

            <div class="footer-right">
                <button
                    class="btn btn--primary"
                    onclick={handleNextOrSave}
                    disabled={currentStepHasConflicts}
                >
                    {#if isLastStep}
                        <Check size={14} />
                        Save
                    {:else}
                        Next
                        <ChevronRight size={14} />
                    {/if}
                </button>
            </div>
        </div>
    </div>
</div>

<style>
    /* ── Overlay ─────────────────────────────────────────────────────────── */
    .overlay {
        position: fixed;
        inset: 0;
        z-index: 1000;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    /* ── Modal ───────────────────────────────────────────────────────────── */
    .modal {
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 12px;
        width: 100%;
        max-width: 600px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
    }

    .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
        gap: 10px;
    }

    .modal-title {
        font-size: 15px;
        font-weight: 700;
        color: var(--color-foreground);
    }

    .header-conflict-note {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 600;
        color: var(--color-warning, #f59e0b);
        margin-left: auto;
    }

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
    .close-btn:hover {
        color: var(--color-foreground);
    }

    /* ── Steps indicator ─────────────────────────────────────────────────── */
    .steps-root {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
    }

    .steps-list {
        display: flex;
        align-items: center;
        padding: 14px 20px;
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
        gap: 0;
    }

    .step-item {
        display: flex;
        align-items: center;
        flex: 1;
    }

    .step-trigger {
        display: flex;
        align-items: center;
        gap: 6px;
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 2px;
        border-radius: 4px;
        white-space: nowrap;
        transition: opacity 0.15s;
    }
    .step-trigger:hover {
        opacity: 0.8;
    }

    .step-indicator-wrap {
        position: relative;
        display: inline-flex;
    }

    .step-indicator {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 600;
        flex-shrink: 0;
        border: 1.5px solid var(--color-border);
        color: var(--color-muted);
        background: var(--color-bg2);
        transition: all 0.2s;
    }

    .step-trigger[data-current] .step-indicator {
        border-color: var(--color-accent);
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 12%, transparent);
    }

    .step-trigger[data-complete] .step-indicator {
        border-color: var(--color-accent);
        background: var(--color-accent);
        color: white;
    }

    .step-conflict-badge {
        position: absolute;
        top: -4px;
        right: -4px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: var(--color-warning, #f59e0b);
        color: white;
        font-size: 8px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .step-label {
        font-size: 12px;
        color: var(--color-muted);
        transition: color 0.15s;
    }

    .step-trigger[data-current] .step-label {
        color: var(--color-foreground);
        font-weight: 600;
    }

    .step-trigger[data-complete] .step-label {
        color: var(--color-foreground);
    }

    .step-separator {
        flex: 1;
        height: 1px;
        background: var(--color-border);
        margin: 0 8px;
        min-width: 12px;
    }

    .step-trigger[data-complete] ~ .step-separator {
        background: var(--color-accent);
    }

    /* ── Step content ────────────────────────────────────────────────────── */
    .step-content-area {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        min-height: 0;
    }

    .step-content-area > [data-state="closed"] {
        display: none;
    }

    /* ── Form fields ─────────────────────────────────────────────────────── */
    .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 16px;
    }
    .field:last-child {
        margin-bottom: 0;
    }

    .field-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--color-foreground);
    }

    .required {
        color: var(--color-accent);
    }

    .field-helper {
        font-size: 11px;
        color: var(--color-muted);
        margin-bottom: 2px;
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
        transition:
            border-color 0.15s,
            box-shadow 0.15s;
    }
    .field-input:focus {
        border-color: var(--color-accent);
        box-shadow: 0 0 0 2px
            color-mix(in srgb, var(--color-accent) 20%, transparent);
    }
    .field-input::placeholder {
        color: var(--color-muted);
    }

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
        transition:
            border-color 0.15s,
            box-shadow 0.15s;
    }
    .field-textarea:focus {
        border-color: var(--color-accent);
        box-shadow: 0 0 0 2px
            color-mix(in srgb, var(--color-accent) 20%, transparent);
    }
    .field-textarea::placeholder {
        color: var(--color-muted);
    }

    .field-textarea--mono {
        font-family: "JetBrains Mono", "Fira Code", monospace;
        font-size: 12px;
    }

    /* ── AI section ──────────────────────────────────────────────────────── */
    .ai-section {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 4px;
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
        padding: 8px 16px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition:
            filter 0.15s,
            opacity 0.15s;
        align-self: flex-start;
    }
    .ai-btn:hover:not(:disabled) {
        filter: brightness(1.15);
    }
    .ai-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .ai-error {
        font-size: 11px;
        color: #ef4444;
    }

    .ai-tip {
        border-left: 3px solid var(--color-accent);
        background: var(--color-bg2);
        padding: 8px 12px;
        font-size: 11px;
        color: var(--color-muted);
        border-radius: 0 6px 6px 0;
        margin-bottom: 14px;
    }

    .ai-label {
        font-size: 11px;
        font-style: italic;
        color: var(--color-muted);
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

    .conflict-options {
        display: flex;
        gap: 6px;
    }

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

    .conflict-opt.mine:hover {
        border-color: var(--color-foreground);
    }

    .conflict-opt.ai {
        background: var(--color-accent);
        border-color: var(--color-accent);
        color: white;
    }

    .conflict-opt.ai:hover {
        filter: brightness(1.15);
    }

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

    /* ── Tools grid ──────────────────────────────────────────────────────── */
    .tools-empty {
        padding: 20px;
        text-align: center;
        color: var(--color-muted);
        font-size: 13px;
        background: var(--color-bg2);
        border: 1px dashed var(--color-border);
        border-radius: 8px;
    }

    .tools-grid {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .tool-checkbox {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 8px 10px;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.15s;
    }
    .tool-checkbox:hover {
        border-color: var(--color-accent);
    }
    .tool-checkbox.checked {
        border-color: var(--color-accent);
        background: color-mix(
            in srgb,
            var(--color-accent) 8%,
            var(--color-bg2)
        );
    }

    .tool-checkbox input[type="checkbox"] {
        width: 14px;
        height: 14px;
        accent-color: var(--color-accent);
        cursor: pointer;
        flex-shrink: 0;
        margin-top: 1px;
    }

    .tool-icon {
        font-size: 16px;
        flex-shrink: 0;
    }

    .tool-info {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
    }

    .tool-name {
        font-size: 13px;
        color: var(--color-foreground);
    }

    .tool-desc {
        font-size: 11px;
        color: var(--color-muted);
        line-height: 1.3;
    }

    /* ── Footer ──────────────────────────────────────────────────────────── */
    .modal-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 20px;
        border-top: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .footer-left,
    .footer-right {
        flex: 1;
    }
    .footer-right {
        display: flex;
        justify-content: flex-end;
    }

    .step-counter {
        font-size: 11px;
        color: var(--color-muted);
        flex-shrink: 0;
    }

    /* ── Buttons ──────────────────────────────────────────────────────────── */
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
    .btn--ghost:hover {
        color: var(--color-foreground);
        border-color: var(--color-foreground);
    }

    .btn--primary {
        background: var(--color-accent);
        color: white;
    }
    .btn--primary:hover:not(:disabled) {
        filter: brightness(1.15);
    }
    .btn--primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    /* ── Spinner animation ───────────────────────────────────────────────── */
    :global(.spin) {
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        from {
            transform: rotate(0deg);
        }
        to {
            transform: rotate(360deg);
        }
    }
</style>
