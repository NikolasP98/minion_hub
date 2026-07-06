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
    import { sendRequest } from "$lib/services/gateway.svelte";
    import { conn } from "$lib/state/gateway/connection.svelte";
    import { hostsState } from "$lib/state/features/hosts.svelte";
    import type { SkillStatusEntry, SkillStatusReport } from "$lib/types/skills";
    import type { ToolStatusEntry, ToolsStatusReport } from "$lib/types/tools";
    import * as m from '$lib/paraglide/messages';
    import { createHotkey } from '$lib/hotkeys';
    import Step0Identity from "./_agent-create-wizard/Step0Identity.svelte";
    import Step1SkillsTools from "./_agent-create-wizard/Step1SkillsTools.svelte";

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

    // ── Tooltip state (cursor-following) ────────────────────────────────────
    let hoveredItem = $state<{ type: 'skill' | 'built-skill' | 'tool'; id: string } | null>(null);
    let tooltipPos = $state({ x: 0, y: 0 });
    let tooltipVisible = $state(false);
    let hoverTimeout: ReturnType<typeof setTimeout> | null = null;
    let showTimeout: ReturnType<typeof setTimeout> | null = null;

    function showPopover(type: 'skill' | 'built-skill' | 'tool', id: string, e: MouseEvent) {
        if (hoverTimeout) clearTimeout(hoverTimeout);
        hoveredItem = { type, id };
        tooltipPos = { x: e.clientX, y: e.clientY };
        // Small delay before showing to avoid flicker on fast mouse moves
        if (showTimeout) clearTimeout(showTimeout);
        showTimeout = setTimeout(() => { tooltipVisible = true; }, 80);
    }

    function trackCursor(e: MouseEvent) {
        if (hoveredItem) {
            tooltipPos = { x: e.clientX, y: e.clientY };
        }
    }

    function hidePopover() {
        if (showTimeout) clearTimeout(showTimeout);
        tooltipVisible = false;
        hoverTimeout = setTimeout(() => { hoveredItem = null; }, 150);
    }

    // ── Models ──────────────────────────────────────────────────────────────
    type ModelItem = { id: string; name: string };
    let modelItems = $state<ModelItem[]>([]);
    let defaultModel = $state('');

    // ── Zag.js steps machine ─────────────────────────────────────────────────
    const STEP_COUNT = 2;
    const stepsData = [
        { title: m.builder_stepIdentity() },
        { title: m.builder_stepSkillsTools() },
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

    // Mod+Enter advances/creates, mirroring the footer button. Ctrl/Meta
    // combos fire inside inputs by default, so this works while typing the
    // agent name in Step 0.
    createHotkey('Mod+Enter', handleNextOrCreate, () => ({ enabled: !isNextDisabled }));
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
    class="overlay"
    role="dialog"
    aria-modal="true"
    aria-label={m.builder_newAgent()}
    tabindex="-1"
    onclick={handleOverlayClick}
    onkeydown={handleKeydown}
>
    <div class="modal">
        <!-- Header -->
        <div class="modal-header">
            <div class="modal-title-row">
                <Bot size={16} />
                <span class="modal-title">{m.builder_newAgent()}</span>
            </div>
            <button
                class="close-btn"
                onclick={onClose}
                aria-label={m.common_close()}
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
                <Step0Identity
                    bind:name
                    bind:emoji
                    bind:model
                    {modelItems}
                    {defaultModel}
                    contentProps={api.getContentProps({ index: 0 })}
                />

                <Step1SkillsTools
                    contentProps={api.getContentProps({ index: 1 })}
                    {skillsLoading}
                    {toolsLoading}
                    {publishedSkills}
                    {gatewaySkills}
                    {gatewayTools}
                    {ineligibleSkills}
                    {skillsBySource}
                    {toolsByGroup}
                    {selectedBuiltSkillIds}
                    {selectedGatewaySkillIds}
                    {selectedToolIds}
                    {totalSelected}
                    {emoji}
                    {name}
                    {model}
                    {hoveredItem}
                    {tooltipPos}
                    {tooltipVisible}
                    {popoverData}
                    {toggleBuiltSkill}
                    {toggleGatewaySkill}
                    {toggleTool}
                    {showPopover}
                    {trackCursor}
                    {hidePopover}
                />
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
                        {m.common_back()}
                    </button>
                {/if}
            </div>

            <span class="step-counter">
                {m.marketplace_wizardStepOf({ step: api.value + 1, total: STEP_COUNT })}
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
                            {m.builder_creating()}
                        {:else}
                            <Check size={14} />
                            {m.builder_create()}
                        {/if}
                    {:else}
                        {m.builder_next()}
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
        position: relative;
        z-index: 1;
    }

    .step-content-area > :global([data-state="closed"]) {
        display: none;
    }

    /* ── Footer ──────────────────────────────────────────────────────────── */
    .modal-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 20px;
        border-top: 1px solid var(--color-border);
        flex-shrink: 0;
        position: relative;
        z-index: 0;
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
        transition: all var(--duration-fast) var(--ease-standard);
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
