<script lang="ts">
    import {
        X,
        ChevronLeft,
        ChevronRight,
        Check,
        Loader2,
        Bot,
        Wrench,
    } from "lucide-svelte";
    import * as steps from "@zag-js/steps";
    import { useMachine, normalizeProps } from "@zag-js/svelte";
    import EmojiPicker from "./EmojiPicker.svelte";
    import Combobox from "$lib/components/ui/Combobox.svelte";
    import { sendRequest } from "$lib/services/gateway.svelte";
    import { conn } from "$lib/state/gateway/connection.svelte";
    import { hostsState } from "$lib/state/features/hosts.svelte";
    import type { SkillStatusEntry, SkillStatusReport } from "$lib/types/skills";
    import type { ToolStatusEntry, ToolsStatusReport } from "$lib/types/tools";

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
    let emoji = $state('\u{1F916}');
    let model = $state('');
    let configDir = $state('.minion');
    let selectedGatewaySkillIds = $state<string[]>([]);
    let selectedBuiltSkillIds = $state<string[]>([]);
    let selectedToolIds = $state<string[]>([]);
    let creating = $state(false);
    let gatewaySkills = $state<SkillStatusEntry[]>([]);
    let publishedSkills = $state<BuiltSkill[]>([]);
    let gatewayTools = $state<ToolStatusEntry[]>([]);
    let toolGroups = $state<Record<string, string[]>>({});
    let skillsLoading = $state(false);
    let toolsLoading = $state(false);

    // ── Popover state ──────────────────────────────────────────────────────
    let hoveredItem = $state<{ type: 'skill' | 'built-skill' | 'tool'; id: string } | null>(null);
    let popoverEl = $state<HTMLDivElement | null>(null);
    let popoverPos = $state({ x: 0, y: 0 });
    let hoverTimeout: ReturnType<typeof setTimeout> | null = null;

    function showPopover(type: 'skill' | 'built-skill' | 'tool', id: string, e: MouseEvent) {
        if (hoverTimeout) clearTimeout(hoverTimeout);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const modalEl = (e.currentTarget as HTMLElement).closest('.modal');
        const modalRect = modalEl?.getBoundingClientRect() ?? { left: 0, top: 0 };
        popoverPos = {
            x: rect.left - modalRect.left + rect.width / 2,
            y: rect.top - modalRect.top - 4,
        };
        hoveredItem = { type, id };
    }

    function hidePopover() {
        hoverTimeout = setTimeout(() => { hoveredItem = null; }, 120);
    }

    // ── Models ──────────────────────────────────────────────────────────────
    type ModelItem = { id: string; name: string };
    let modelItems = $state<ModelItem[]>([]);
    let defaultModel = $state('');

    // ── Zag.js steps machine ─────────────────────────────────────────────────
    const STEP_COUNT = 2;
    const stepsData = [
        { title: "Identity" },
        { title: "Skills & Tools" },
    ];

    const service = useMachine(steps.machine, () => ({
        id: "agent-create-wizard",
        count: stepsData.length,
    }));
    const api = $derived(steps.connect(service, normalizeProps));

    const isLastStep = $derived(api.value === STEP_COUNT - 1);
    const canAdvanceStep0 = $derived(name.trim().length >= 3);

    // ── Derived groups ──────────────────────────────────────────────────────
    const eligibleSkills = $derived(gatewaySkills.filter((s) => s.eligible));
    const ineligibleSkills = $derived(gatewaySkills.filter((s) => !s.eligible));
    const totalSelected = $derived(
        selectedGatewaySkillIds.length + selectedBuiltSkillIds.length + selectedToolIds.length
    );

    // Group skills by source
    const skillsBySource = $derived.by(() => {
        const groups = new Map<string, SkillStatusEntry[]>();
        for (const s of eligibleSkills) {
            const key = s.source || 'other';
            const arr = groups.get(key);
            if (arr) arr.push(s);
            else groups.set(key, [s]);
        }
        return groups;
    });

    // Group tools by their first group tag
    const toolsByGroup = $derived.by(() => {
        const groups = new Map<string, ToolStatusEntry[]>();
        for (const t of gatewayTools) {
            const groupTag = t.groups[0]?.replace(/^group:/, '') || 'other';
            const arr = groups.get(groupTag);
            if (arr) arr.push(t);
            else groups.set(groupTag, [t]);
        }
        return groups;
    });

    // ── Fetch models + skills + tools when gateway connects ────────────────
    let modelsLoaded = $state(false);
    let skillsLoaded = $state(false);
    let toolsLoaded = $state(false);
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
        // Fetch gateway tools
        if (!toolsLoaded) {
            toolsLoading = true;
            sendRequest('tools.status', {}).then((raw) => {
                const report = raw as ToolsStatusReport;
                if (report?.tools) {
                    gatewayTools = report.tools;
                }
                if (report?.groups) {
                    toolGroups = report.groups;
                }
                toolsLoaded = true;
                toolsLoading = false;
            }).catch(() => {
                toolsLoaded = true;
                toolsLoading = false;
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

    // ── Toggles ─────────────────────────────────────────────────────────────
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

    function toggleTool(toolId: string) {
        if (selectedToolIds.includes(toolId)) {
            selectedToolIds = selectedToolIds.filter((k) => k !== toolId);
        } else {
            selectedToolIds = [...selectedToolIds, toolId];
        }
    }

    // ── Popover data helpers ────────────────────────────────────────────────
    function getPopoverData() {
        if (!hoveredItem) return null;
        if (hoveredItem.type === 'skill') {
            const s = gatewaySkills.find((sk) => sk.skillKey === hoveredItem!.id);
            if (!s) return null;
            return { emoji: s.emoji || '\u{1F4D6}', name: s.name, desc: s.description, badge: s.source };
        }
        if (hoveredItem.type === 'built-skill') {
            const s = publishedSkills.find((sk) => sk.id === hoveredItem!.id);
            if (!s) return null;
            return { emoji: s.emoji || '\u{1F4D6}', name: s.name, desc: s.description, badge: 'custom' };
        }
        if (hoveredItem.type === 'tool') {
            const t = gatewayTools.find((tk) => tk.id === hoveredItem!.id);
            if (!t) return null;
            const tags: string[] = [];
            if (t.mcpExport) tags.push('MCP');
            if (t.multi) tags.push('multi');
            if (t.optional) tags.push('opt');
            return {
                emoji: null,
                name: t.id,
                desc: t.groups.map((g) => g.replace(/^group:/, '')).join(', ') || 'tool',
                badge: tags.join(' ') || null,
            };
        }
        return null;
    }

    const popoverData = $derived(getPopoverData());

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
            const workspace = `~/${configDir}/workspaces/${name.trim()}`;
            const params: Record<string, unknown> = {
                name: name.trim(),
                workspace,
            };
            if (model.trim()) params.model = model.trim();
            if (emoji.trim()) params.emoji = emoji.trim();

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

            // 3. Enable selected tools on the agent
            for (const toolId of selectedToolIds) {
                await sendRequest('tools.update', {
                    agentId,
                    toolId,
                    enabled: true,
                });
            }

            // 4. Persist built skill selections via hub API
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

            // 5. Notify parent
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
                </div>

                <!-- Step 1: Skills & Tools -->
                <div {...api.getContentProps({ index: 1 })}>
                    <span class="field-helper">
                        Select skills and tools ({totalSelected} selected)
                    </span>

                    {#if skillsLoading || toolsLoading}
                        <div class="cap-loading">
                            <Loader2 size={18} class="spin" />
                            <span>Loading capabilities...</span>
                        </div>
                    {:else}
                        <!-- Built Skills (custom) -->
                        {#if publishedSkills.length > 0}
                            <div class="cap-group">
                                <span class="cap-group-label">Custom Skills</span>
                                <div class="icon-grid">
                                    {#each publishedSkills as skill (skill.id)}
                                        {@const selected = selectedBuiltSkillIds.includes(skill.id)}
                                        <button
                                            type="button"
                                            class="icon-btn"
                                            class:selected
                                            onclick={() => toggleBuiltSkill(skill.id)}
                                            onmouseenter={(e) => showPopover('built-skill', skill.id, e)}
                                            onmouseleave={hidePopover}
                                            aria-label={skill.name}
                                        >
                                            <span class="icon-emoji">{skill.emoji || '\u{1F4D6}'}</span>
                                            {#if selected}<span class="icon-check"><Check size={10} /></span>{/if}
                                        </button>
                                    {/each}
                                </div>
                            </div>
                        {/if}

                        <!-- Gateway Skills grouped by source -->
                        {#each [...skillsBySource.entries()] as [source, skills] (source)}
                            <div class="cap-group">
                                <span class="cap-group-label">
                                    {source === 'bundled' ? 'Built-in Skills' : source}
                                </span>
                                <div class="icon-grid">
                                    {#each skills as skill (skill.skillKey)}
                                        {@const selected = selectedGatewaySkillIds.includes(skill.skillKey)}
                                        <button
                                            type="button"
                                            class="icon-btn"
                                            class:selected
                                            class:icon-disabled={skill.disabled}
                                            onclick={() => toggleGatewaySkill(skill.skillKey)}
                                            onmouseenter={(e) => showPopover('skill', skill.skillKey, e)}
                                            onmouseleave={hidePopover}
                                            aria-label={skill.name}
                                        >
                                            <span class="icon-emoji">{skill.emoji || '\u{1F4D6}'}</span>
                                            {#if selected}<span class="icon-check"><Check size={10} /></span>{/if}
                                        </button>
                                    {/each}
                                </div>
                            </div>
                        {/each}

                        <!-- Ineligible skills -->
                        {#if ineligibleSkills.length > 0}
                            <div class="cap-group">
                                <span class="cap-group-label cap-group-label--dim">Unavailable ({ineligibleSkills.length})</span>
                                <div class="icon-grid">
                                    {#each ineligibleSkills as skill (skill.skillKey)}
                                        <button
                                            type="button"
                                            class="icon-btn icon-ineligible"
                                            disabled
                                            onmouseenter={(e) => showPopover('skill', skill.skillKey, e)}
                                            onmouseleave={hidePopover}
                                            aria-label="{skill.name} (unavailable)"
                                        >
                                            <span class="icon-emoji">{skill.emoji || '\u{1F4D6}'}</span>
                                        </button>
                                    {/each}
                                </div>
                            </div>
                        {/if}

                        <!-- Tools grouped by group tag -->
                        {#if gatewayTools.length > 0}
                            {#each [...toolsByGroup.entries()] as [group, tools] (group)}
                                <div class="cap-group">
                                    <span class="cap-group-label">
                                        <Wrench size={10} class="cap-group-icon" />
                                        {group}
                                    </span>
                                    <div class="icon-grid">
                                        {#each tools as tool (tool.id)}
                                            {@const selected = selectedToolIds.includes(tool.id)}
                                            <button
                                                type="button"
                                                class="icon-btn icon-btn--tool"
                                                class:selected
                                                onclick={() => toggleTool(tool.id)}
                                                onmouseenter={(e) => showPopover('tool', tool.id, e)}
                                                onmouseleave={hidePopover}
                                                aria-label={tool.id}
                                            >
                                                <span class="icon-tool-label">{tool.id.slice(0, 2)}</span>
                                                {#if selected}<span class="icon-check"><Check size={10} /></span>{/if}
                                            </button>
                                        {/each}
                                    </div>
                                </div>
                            {/each}
                        {/if}

                        {#if gatewaySkills.length === 0 && publishedSkills.length === 0 && gatewayTools.length === 0}
                            <div class="cap-empty">
                                No capabilities available. Add skills or tools to the gateway first.
                            </div>
                        {/if}
                    {/if}

                    <!-- Summary -->
                    <div class="summary">
                        <div class="summary-row">
                            <span class="summary-emoji">{emoji}</span>
                            <span class="summary-name">{name || 'Untitled'}</span>
                        </div>
                        {#if model}
                            <div class="summary-detail">
                                <code>{model}</code>
                            </div>
                        {/if}
                        <div class="summary-detail">
                            {totalSelected} capabilities selected
                        </div>
                    </div>

                    <!-- Popover -->
                    {#if hoveredItem && popoverData}
                        <div
                            class="popover"
                            bind:this={popoverEl}
                            style="left: {popoverPos.x}px; top: {popoverPos.y}px;"
                        >
                            <div class="popover-inner">
                                {#if popoverData.emoji}
                                    <span class="popover-emoji">{popoverData.emoji}</span>
                                {/if}
                                <span class="popover-name">{popoverData.name}</span>
                                {#if popoverData.desc}
                                    <span class="popover-desc">{popoverData.desc}</span>
                                {/if}
                                {#if popoverData.badge}
                                    <span class="popover-badge">{popoverData.badge}</span>
                                {/if}
                            </div>
                        </div>
                    {/if}
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
        position: relative;
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
        margin-bottom: 6px;
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

    /* ── Name row with emoji ───────────────────────────────────────────── */
    .name-row {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .name-field {
        flex: 1;
    }

    /* ── Model item styles ─────────────────────────────────────────────── */
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

    /* ── Capability groups ──────────────────────────────────────────────── */
    .cap-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 24px;
        color: var(--color-muted);
        font-size: 13px;
    }

    .cap-empty {
        padding: 24px;
        text-align: center;
        color: var(--color-muted);
        font-size: 13px;
        background: var(--color-bg2);
        border: 1px dashed var(--color-border);
        border-radius: 8px;
        margin-top: 8px;
    }

    .cap-group {
        margin-bottom: 14px;
    }

    .cap-group-label {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
        margin-bottom: 6px;
    }

    .cap-group-label--dim {
        opacity: 0.6;
    }

    :global(.cap-group-icon) {
        opacity: 0.6;
    }

    /* ── Icon grid ──────────────────────────────────────────────────────── */
    .icon-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        justify-content: flex-start;
    }

    .icon-btn {
        position: relative;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-bg2);
        border: 1.5px solid var(--color-border);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.15s;
        font-family: inherit;
        padding: 0;
        flex-shrink: 0;
    }
    .icon-btn:hover {
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 6%, var(--color-bg2));
        transform: translateY(-1px);
    }
    .icon-btn.selected {
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 12%, var(--color-bg2));
        box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--color-accent) 30%, transparent);
    }

    .icon-btn.icon-disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .icon-btn.icon-ineligible {
        opacity: 0.25;
        cursor: default;
    }

    .icon-btn--tool {
        background: var(--color-bg2);
    }

    .icon-emoji {
        font-size: 16px;
        line-height: 1;
    }

    .icon-tool-label {
        font-size: 10px;
        font-weight: 700;
        font-family: "JetBrains Mono", "Fira Code", monospace;
        color: var(--color-muted);
        text-transform: lowercase;
        line-height: 1;
    }
    .icon-btn.selected .icon-tool-label {
        color: var(--color-accent);
    }

    .icon-check {
        position: absolute;
        top: -4px;
        right: -4px;
        width: 14px;
        height: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--color-accent);
        color: white;
        border-radius: 50%;
        line-height: 1;
    }

    /* ── Popover ─────────────────────────────────────────────────────────── */
    .popover {
        position: absolute;
        z-index: 10;
        transform: translate(-50%, -100%);
        pointer-events: none;
        animation: popover-inflate 0.18s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    }

    @keyframes popover-inflate {
        from {
            opacity: 0;
            transform: translate(-50%, -100%) scale(0.85);
        }
        to {
            opacity: 1;
            transform: translate(-50%, -100%) scale(1);
        }
    }

    .popover-inner {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        padding: 8px 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        max-width: 220px;
        text-align: center;
    }

    .popover-emoji {
        font-size: 18px;
        line-height: 1;
    }

    .popover-name {
        font-size: 12px;
        font-weight: 700;
        color: var(--color-foreground);
        line-height: 1.2;
    }

    .popover-desc {
        font-size: 10px;
        color: var(--color-muted);
        line-height: 1.3;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .popover-badge {
        font-size: 9px;
        font-weight: 600;
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 15%, transparent);
        border-radius: 3px;
        padding: 1px 5px;
        margin-top: 1px;
    }

    /* ── Summary ─────────────────────────────────────────────────────────── */
    .summary {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-top: 16px;
    }

    .summary-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .summary-emoji {
        font-size: 18px;
        line-height: 1;
    }

    .summary-name {
        font-size: 13px;
        font-weight: 700;
        color: var(--color-foreground);
    }

    .summary-detail {
        font-size: 11px;
        color: var(--color-muted);
    }

    .summary-detail code {
        font-family: "JetBrains Mono", "Fira Code", monospace;
        font-size: 10px;
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
