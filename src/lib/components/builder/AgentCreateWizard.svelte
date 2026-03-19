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
    import EmojiPicker from "./EmojiPicker.svelte";
    import Combobox from "$lib/components/ui/Combobox.svelte";
    import { sendRequest } from "$lib/services/gateway.svelte";
    import { conn } from "$lib/state/gateway/connection.svelte";
    import { hostsState } from "$lib/state/features/hosts.svelte";
    import type { SkillStatusEntry, SkillStatusReport } from "$lib/types/skills";

    // ── Types ────────────────────────────────────────────────────────────────
    interface BuiltSkill {
        id: string;
        name: string;
        description: string;
        emoji: string;
        status: string;
    }

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
    let selectedGatewaySkillIds = $state<string[]>([]);
    let selectedBuiltSkillIds = $state<string[]>([]);
    let creating = $state(false);
    let gatewaySkills = $state<SkillStatusEntry[]>([]);
    let publishedSkills = $state<BuiltSkill[]>([]);
    let skillsLoading = $state(false);

    // ── Models ──────────────────────────────────────────────────────────────
    type ModelItem = { id: string; name: string };
    let modelItems = $state<ModelItem[]>([]);
    let defaultModel = $state('');

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

    // ── Derived skill groups ──────────────────────────────────────────────────
    const eligibleSkills = $derived(gatewaySkills.filter((s) => s.eligible));
    const ineligibleSkills = $derived(gatewaySkills.filter((s) => !s.eligible));
    const totalSelectedSkills = $derived(selectedGatewaySkillIds.length + selectedBuiltSkillIds.length);
    const hasBuiltSkills = $derived(publishedSkills.length > 0);
    const hasGatewaySkills = $derived(gatewaySkills.length > 0);

    // ── Fetch models + skills when gateway connects ──────────────────────────
    let modelsLoaded = $state(false);
    let skillsLoaded = $state(false);

    let builtSkillsLoaded = $state(false);

    $effect(() => {
        if (!conn.connected) return;
        // Fetch models
        if (!modelsLoaded) {
            sendRequest('models.list', {}).then((raw) => {
                const res = raw as { models?: ModelItem[]; defaultModel?: string } | null;
                if (res?.models) {
                    const seen = new Set<string>();
                    modelItems = res.models.filter((m) =>
                        seen.has(m.id) ? false : (seen.add(m.id), true),
                    );
                }
                if (res?.defaultModel) {
                    defaultModel = res.defaultModel;
                    if (!model) model = res.defaultModel;
                }
                modelsLoaded = true;
            }).catch(() => {
                modelsLoaded = true;
            });
        }
        // Fetch gateway skills
        if (!skillsLoaded) {
            skillsLoading = true;
            sendRequest('skills.status', {}).then((raw) => {
                const report = raw as SkillStatusReport;
                if (report?.skills) {
                    gatewaySkills = report.skills;
                }
                skillsLoaded = true;
                skillsLoading = false;
            }).catch(() => {
                skillsLoaded = true;
                skillsLoading = false;
            });
        }
        // Fetch published built skills
        if (!builtSkillsLoaded) {
            fetch('/api/builder/skills?status=published')
                .then((r) => r.json())
                .then((data) => {
                    publishedSkills = data.skills ?? [];
                    builtSkillsLoaded = true;
                })
                .catch(() => {
                    builtSkillsLoaded = true;
                });
        }
    });

    // ── Skill toggles ────────────────────────────────────────────────────────
    function toggleGatewaySkill(skillKey: string) {
        if (selectedGatewaySkillIds.includes(skillKey)) {
            selectedGatewaySkillIds = selectedGatewaySkillIds.filter((k) => k !== skillKey);
        } else {
            selectedGatewaySkillIds = [...selectedGatewaySkillIds, skillKey];
        }
    }

    function toggleBuiltSkill(skillId: string) {
        if (selectedBuiltSkillIds.includes(skillId)) {
            selectedBuiltSkillIds = selectedBuiltSkillIds.filter((k) => k !== skillId);
        } else {
            selectedBuiltSkillIds = [...selectedBuiltSkillIds, skillId];
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
            // 1. Create the agent via gateway protocol
            const params: Record<string, unknown> = {
                name: name.trim(),
            };
            if (model.trim()) params.model = model.trim();
            if (emoji.trim()) params.emoji = emoji.trim();
            if (description.trim()) params.description = description.trim();
            if (systemPrompt.trim()) params.systemPrompt = systemPrompt.trim();

            const res = (await sendRequest('agents.create', params)) as {
                agentId?: string;
            } | null;

            const agentId = res?.agentId;
            if (!agentId) {
                throw new Error('Agent creation failed: no agent ID returned');
            }

            // 2. Set selected gateway skills on the agent
            if (selectedGatewaySkillIds.length > 0) {
                await sendRequest('agents.skills.set', {
                    agentId,
                    skills: selectedGatewaySkillIds,
                });
            }

            // 3. Persist built skill selections via hub API
            if (selectedBuiltSkillIds.length > 0 && hostsState.activeHostId) {
                await fetch('/api/builder/agent-skills', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        gatewayAgentId: agentId,
                        serverId: hostsState.activeHostId,
                        skillIds: selectedBuiltSkillIds,
                    }),
                });
            }

            // 4. Notify parent
            onComplete(agentId);
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
                        <Combobox
                            id="wizard-model"
                            items={modelItems}
                            itemToValue={(m) => m.id}
                            itemToString={(m) => m.name}
                            bind:value={model}
                            label="Model"
                            placeholder="Search models\u2026"
                        >
                            {#snippet item({ item: m, selected, itemTextProps })}
                                <span
                                    class="model-item-name"
                                    class:model-item-selected={selected}
                                    {...itemTextProps}
                                >{m.name}</span>
                                {#if m.id === defaultModel}
                                    <span class="model-badge">default</span>
                                {/if}
                                <span class="model-item-id">{m.id}</span>
                            {/snippet}
                        </Combobox>
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
                        Select skills to enable for this agent ({totalSelectedSkills} selected)
                    </span>

                    {#if skillsLoading}
                        <div class="skills-loading">
                            <Loader2 size={18} class="spin" />
                            <span>Loading skills...</span>
                        </div>
                    {:else if !hasBuiltSkills && !hasGatewaySkills}
                        <div class="skills-empty">
                            No skills available. Create skills in the Builder tab or add them to the gateway.
                        </div>
                    {:else}
                        <!-- Your Skills (published built skills) -->
                        {#if hasBuiltSkills}
                            {#if hasGatewaySkills}
                                <span class="skills-section-label">Your Skills</span>
                            {/if}
                            <div class="skills-grid">
                                {#each publishedSkills as skill (skill.id)}
                                    {@const selected = selectedBuiltSkillIds.includes(skill.id)}
                                    <button
                                        type="button"
                                        class="skill-card"
                                        class:selected
                                        onclick={() => toggleBuiltSkill(skill.id)}
                                    >
                                        <span class="skill-emoji">{skill.emoji || '\u{1F4D6}'}</span>
                                        <div class="skill-info">
                                            <span class="skill-name">{skill.name}</span>
                                            {#if skill.description}
                                                <span class="skill-desc">{skill.description}</span>
                                            {/if}
                                        </div>
                                        <span class="skill-badge skill-badge--custom">custom</span>
                                        {#if selected}
                                            <span class="skill-check">
                                                <Check size={14} />
                                            </span>
                                        {/if}
                                    </button>
                                {/each}
                            </div>
                        {/if}

                        <!-- Gateway Skills -->
                        {#if hasGatewaySkills}
                            {#if hasBuiltSkills}
                                <span class="skills-section-label" class:skills-section-label--spaced={hasBuiltSkills}>Gateway Skills</span>
                            {/if}
                            <div class="skills-grid">
                                {#each eligibleSkills as skill (skill.skillKey)}
                                    {@const selected = selectedGatewaySkillIds.includes(skill.skillKey)}
                                    <button
                                        type="button"
                                        class="skill-card"
                                        class:selected
                                        class:skill-disabled={skill.disabled}
                                        onclick={() => toggleGatewaySkill(skill.skillKey)}
                                    >
                                        <span class="skill-emoji">{skill.emoji || '\u{1F4D6}'}</span>
                                        <div class="skill-info">
                                            <span class="skill-name">{skill.name}</span>
                                            {#if skill.description}
                                                <span class="skill-desc">{skill.description}</span>
                                            {/if}
                                        </div>
                                        {#if skill.disabled}
                                            <span class="skill-badge skill-badge--off">disabled</span>
                                        {:else if selected}
                                            <span class="skill-check">
                                                <Check size={14} />
                                            </span>
                                        {/if}
                                    </button>
                                {/each}
                            </div>

                            <!-- Ineligible skills: compact icon grid at bottom -->
                            {#if ineligibleSkills.length > 0}
                                <div class="ineligible-section">
                                    <span class="ineligible-label">Unavailable ({ineligibleSkills.length})</span>
                                    <div class="ineligible-grid">
                                        {#each ineligibleSkills as skill (skill.skillKey)}
                                            <span
                                                class="ineligible-icon"
                                                title="{skill.name} — missing dependencies"
                                            >{skill.emoji || '\u{1F4D6}'}</span>
                                        {/each}
                                    </div>
                                </div>
                            {/if}
                        {/if}
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
                            Skills: {totalSelectedSkills}
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

    /* ── Model item styles (inside Combobox snippet) ────────────────────── */
    .model-item-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--color-foreground);
    }
    .model-item-selected {
        color: var(--color-accent);
        font-weight: 600;
    }

    .model-badge {
        font-size: 10px;
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 15%, transparent);
        border-radius: 3px;
        padding: 1px 5px;
        flex-shrink: 0;
    }

    .model-item-id {
        color: var(--color-muted);
        font-size: 11px;
        font-family: "JetBrains Mono", "Fira Code", monospace;
        flex-shrink: 0;
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

    .skill-disabled {
        opacity: 0.5;
    }

    .skill-badge {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 3px;
        flex-shrink: 0;
        margin-top: 2px;
    }

    .skill-badge--off {
        color: var(--color-muted);
        background: var(--color-bg3, var(--color-bg));
    }

    .skill-badge--custom {
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 15%, transparent);
    }

    .skills-section-label {
        display: block;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--color-muted);
        margin-top: 4px;
        margin-bottom: 4px;
    }

    .skills-section-label--spaced {
        margin-top: 16px;
        padding-top: 12px;
        border-top: 1px dashed var(--color-border);
    }

    /* ── Ineligible skills (compact icon grid) ────────────────────────── */
    .ineligible-section {
        margin-top: 16px;
        padding-top: 12px;
        border-top: 1px dashed var(--color-border);
    }

    .ineligible-label {
        font-size: 10px;
        color: var(--color-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-weight: 600;
        display: block;
        margin-bottom: 6px;
    }

    .ineligible-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .ineligible-icon {
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 14px;
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 5px;
        opacity: 0.4;
        cursor: default;
        line-height: 1;
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
