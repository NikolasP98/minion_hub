<script lang="ts">
    import {
        X,
        ChevronLeft,
        ChevronRight,
        Check,
        Loader2,
        Bot,
    } from "lucide-svelte";
    import * as steps from "@zag-js/steps";
    import { useMachine, normalizeProps } from "@zag-js/svelte";
    import { onMount } from "svelte";
    import EmojiPicker from "./EmojiPicker.svelte";

    // ── Types ────────────────────────────────────────────────────────────────
    interface Props {
        onComplete: (id: string) => void;
        onClose: () => void;
    }

    let { onComplete, onClose }: Props = $props();

    // ── Local form state ─────────────────────────────────────────────────────
    let name = $state('');
    let description = $state('');
    let emoji = $state('\u{1F916}');
    let model = $state('');
    let systemPrompt = $state('');
    let temperature = $state(0.7);
    let maxTokens = $state(4096);
    let selectedSkillIds = $state<string[]>([]);
    let creating = $state(false);
    let publishedSkills = $state<Array<{ id: string; name: string; emoji: string; description: string }>>([]);
    let skillsLoading = $state(false);

    const emojiOptions = ['\u{1F916}', '\u{1F9E0}', '\u{1F4AC}', '\u{1F527}', '\u{1F4CA}', '\u{1F3AF}', '\u26A1', '\u{1F310}'];

    // ── Zag.js steps machine ─────────────────────────────────────────────────
    const STEP_COUNT = 4;
    const stepsData = [
        { title: "Identity" },
        { title: "Model & Prompt" },
        { title: "Skills" },
        { title: "Behavior" },
    ];

    const service = useMachine(steps.machine, () => ({
        id: "agent-create-wizard",
        count: stepsData.length,
    }));
    const api = $derived(steps.connect(service, normalizeProps));

    const isLastStep = $derived(api.value === STEP_COUNT - 1);
    const canAdvanceStep0 = $derived(name.trim().length >= 3);

    // ── Fetch published skills ───────────────────────────────────────────────
    onMount(async () => {
        skillsLoading = true;
        try {
            const res = await fetch('/api/builder/skills');
            if (res.ok) {
                const data = await res.json();
                publishedSkills = (data as Array<{ id: string; name: string; emoji: string; description: string; status: string }>)
                    .filter((s) => s.status === 'published');
            }
        } catch {
            // Silently fail — skills step is optional
        } finally {
            skillsLoading = false;
        }
    });

    // ── Skill toggle ─────────────────────────────────────────────────────────
    function toggleSkill(skillId: string) {
        if (selectedSkillIds.includes(skillId)) {
            selectedSkillIds = selectedSkillIds.filter((id) => id !== skillId);
        } else {
            selectedSkillIds = [...selectedSkillIds, skillId];
        }
    }

    // ── Actions ──────────────────────────────────────────────────────────────
    function handleNextOrCreate() {
        if (isLastStep) {
            handleCreate();
        } else {
            api.goToNextStep();
        }
    }

    async function handleCreate() {
        creating = true;
        try {
            // 1. Create the agent
            const res = await fetch('/api/builder/agents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    emoji,
                    description: description.trim(),
                    model: model.trim(),
                    systemPrompt: systemPrompt.trim(),
                    temperature,
                    maxTokens,
                }),
            });

            if (!res.ok) {
                throw new Error(`Failed to create agent: ${res.status}`);
            }

            const { id } = await res.json();

            // 2. Attach selected skills
            for (const skillId of selectedSkillIds) {
                await fetch(`/api/builder/agents/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'add-skill', skillId }),
                });
            }

            // 3. Notify parent
            onComplete(id);
        } catch (err) {
            console.error('Agent creation failed:', err);
        } finally {
            creating = false;
        }
    }

    function handleOverlayClick(e: MouseEvent) {
        if (e.target === e.currentTarget) onClose();
    }

    function handleKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") onClose();
    }

    // ── Derived: is Next/Create disabled? ────────────────────────────────────
    const isNextDisabled = $derived.by(() => {
        if (api.value === 0) return !canAdvanceStep0;
        if (isLastStep) return creating;
        return false;
    });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
    class="overlay"
    role="dialog"
    aria-modal="true"
    aria-label="New Agent"
    tabindex="-1"
    onclick={handleOverlayClick}
    onkeydown={handleKeydown}
>
    <div class="modal">
        <!-- Header -->
        <div class="modal-header">
            <div class="modal-title-row">
                <Bot size={16} />
                <span class="modal-title">New Agent</span>
            </div>
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
                            <span class="step-indicator" {...api.getIndicatorProps({ index })}>
                                {#if api.getItemState({ index }).completed}
                                    <Check size={12} />
                                {:else}
                                    {index + 1}
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
                <!-- Step 0: Identity -->
                <div {...api.getContentProps({ index: 0 })}>
                    <div class="field">
                        <label class="field-label" for="agent-name">
                            Name <span class="required">*</span>
                        </label>
                        <div class="name-row">
                            <EmojiPicker value={emoji} onSelect={(e) => { emoji = e; }} size="md" />
                            <input
                                id="agent-name"
                                class="field-input name-field"
                                type="text"
                                bind:value={name}
                                placeholder="e.g. Research Assistant, Code Reviewer"
                                required
                            />
                        </div>
                        {#if name.length > 0 && name.trim().length < 3}
                            <span class="field-error">Name must be at least 3 characters</span>
                        {/if}
                    </div>

                    <div class="field">
                        <label class="field-label" for="agent-desc">Description</label>
                        <textarea
                            id="agent-desc"
                            class="field-textarea"
                            rows="2"
                            bind:value={description}
                            placeholder="Briefly describe what this agent does"
                        ></textarea>
                    </div>
                </div>

                <!-- Step 1: Model & Prompt -->
                <div {...api.getContentProps({ index: 1 })}>
                    <div class="field">
                        <label class="field-label" for="agent-model">Model</label>
                        <input
                            id="agent-model"
                            class="field-input"
                            type="text"
                            bind:value={model}
                            placeholder="e.g. claude-sonnet-4, gpt-4o, llama-3"
                        />
                    </div>

                    <div class="field">
                        <label class="field-label" for="agent-prompt">System Prompt</label>
                        <span class="field-helper">Define the agent's role and behavioral guidelines</span>
                        <textarea
                            id="agent-prompt"
                            class="field-textarea field-textarea--mono"
                            rows="6"
                            bind:value={systemPrompt}
                            placeholder="You are a helpful assistant that..."
                        ></textarea>
                    </div>
                </div>

                <!-- Step 2: Skills -->
                <div {...api.getContentProps({ index: 2 })}>
                    <span class="field-helper">
                        Assign published skills to this agent (you can add more later)
                    </span>

                    {#if skillsLoading}
                        <div class="skills-loading">
                            <Loader2 size={18} class="spin" />
                            <span>Loading skills...</span>
                        </div>
                    {:else if publishedSkills.length === 0}
                        <div class="skills-empty">
                            No published skills available. You can add skills later.
                        </div>
                    {:else}
                        <div class="skills-grid">
                            {#each publishedSkills as skill (skill.id)}
                                {@const selected = selectedSkillIds.includes(skill.id)}
                                <button
                                    type="button"
                                    class="skill-card"
                                    class:selected
                                    onclick={() => toggleSkill(skill.id)}
                                >
                                    <span class="skill-emoji">{skill.emoji || '\u{1F4D6}'}</span>
                                    <div class="skill-info">
                                        <span class="skill-name">{skill.name}</span>
                                        {#if skill.description}
                                            <span class="skill-desc">{skill.description}</span>
                                        {/if}
                                    </div>
                                    {#if selected}
                                        <span class="skill-check">
                                            <Check size={14} />
                                        </span>
                                    {/if}
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>

                <!-- Step 3: Behavior -->
                <div {...api.getContentProps({ index: 3 })}>
                    <div class="field">
                        <label class="field-label" for="agent-temp">
                            Temperature: {temperature}
                        </label>
                        <input
                            id="agent-temp"
                            class="field-range"
                            type="range"
                            min="0"
                            max="1"
                            step="0.1"
                            bind:value={temperature}
                        />
                        <div class="range-labels">
                            <span>Precise</span>
                            <span>Creative</span>
                        </div>
                    </div>

                    <div class="field">
                        <label class="field-label" for="agent-tokens">Max Tokens</label>
                        <input
                            id="agent-tokens"
                            class="field-input"
                            type="number"
                            bind:value={maxTokens}
                            min="1"
                        />
                    </div>

                    <!-- Summary -->
                    <div class="summary">
                        <div class="summary-title">Summary</div>
                        <div class="summary-row">
                            <span class="summary-emoji">{emoji}</span>
                            <span class="summary-name">{name || 'Untitled'}</span>
                        </div>
                        {#if model}
                            <div class="summary-detail">
                                Model: <code>{model}</code>
                            </div>
                        {/if}
                        <div class="summary-detail">
                            Skills: {selectedSkillIds.length}
                        </div>
                        <div class="summary-detail">
                            Temperature: {temperature}
                        </div>
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
                    onclick={handleNextOrCreate}
                    disabled={isNextDisabled}
                >
                    {#if isLastStep}
                        {#if creating}
                            <Loader2 size={14} class="spin" />
                            Creating...
                        {:else}
                            <Check size={14} />
                            Create
                        {/if}
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
        max-width: 480px;
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

    .modal-title-row {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--color-foreground);
    }

    .modal-title {
        font-size: 15px;
        font-weight: 700;
        color: var(--color-foreground);
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

    .field-error {
        font-size: 11px;
        color: var(--color-destructive, #ef4444);
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

    /* ── Name row with emoji ───────────────────────────────────────────── */
    .name-row {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .name-field {
        flex: 1;
    }

    /* REMOVED: .emoji-row, .emoji-btn (replaced by EmojiPicker component)
    .emoji-btn-removed {
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 18px;
        background: var(--color-bg2);
        border: 1.5px solid var(--color-border);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.15s;
    }
    .emoji-btn-removed:hover { display: none; }
    */

    /* ── Range input ─────────────────────────────────────────────────────── */
    .field-range {
        width: 100%;
        accent-color: var(--color-accent);
        cursor: pointer;
    }

    .range-labels {
        display: flex;
        justify-content: space-between;
        font-size: 10px;
        color: var(--color-muted);
    }

    /* ── Skills ──────────────────────────────────────────────────────────── */
    .skills-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 24px;
        color: var(--color-muted);
        font-size: 13px;
    }

    .skills-empty {
        padding: 24px;
        text-align: center;
        color: var(--color-muted);
        font-size: 13px;
        background: var(--color-bg2);
        border: 1px dashed var(--color-border);
        border-radius: 8px;
        margin-top: 8px;
    }

    .skills-grid {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-top: 8px;
    }

    .skill-card {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 10px 12px;
        background: var(--color-bg2);
        border: 1.5px solid var(--color-border);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.15s;
        text-align: left;
        font-family: inherit;
    }
    .skill-card:hover {
        border-color: var(--color-accent);
    }
    .skill-card.selected {
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 8%, var(--color-bg2));
    }

    .skill-emoji {
        font-size: 18px;
        flex-shrink: 0;
        line-height: 1;
        margin-top: 1px;
    }

    .skill-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
        flex: 1;
    }

    .skill-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-foreground);
    }

    .skill-desc {
        font-size: 11px;
        color: var(--color-muted);
        line-height: 1.3;
        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
    }

    .skill-check {
        display: flex;
        align-items: center;
        color: var(--color-accent);
        flex-shrink: 0;
        margin-top: 2px;
    }

    /* ── Summary ─────────────────────────────────────────────────────────── */
    .summary {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .summary-title {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
        margin-bottom: 2px;
    }

    .summary-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .summary-emoji {
        font-size: 20px;
        line-height: 1;
    }

    .summary-name {
        font-size: 14px;
        font-weight: 700;
        color: var(--color-foreground);
    }

    .summary-detail {
        font-size: 12px;
        color: var(--color-muted);
    }

    .summary-detail code {
        font-family: "JetBrains Mono", "Fira Code", monospace;
        font-size: 11px;
        background: var(--color-bg3, var(--color-bg));
        padding: 1px 5px;
        border-radius: 3px;
        color: var(--color-foreground);
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
