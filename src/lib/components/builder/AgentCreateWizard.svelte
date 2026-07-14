<script lang="ts">
  import { Button } from '$lib/components/ui';
  import { normalizeButtonProps } from '$lib/components/users/button-props';
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
    import { fetchJson } from '$lib/api/fetch-json';
    import { toastError } from '$lib/state/ui/toast.svelte';
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
    let selectedBuiltSkillIds = $state<string[]>([]);
    let creating = $state(false);
    let publishedSkills = $state<BuiltSkill[]>([]);
    let skillsLoading = $state(false);

    // ── Tooltip state (cursor-following) ────────────────────────────────────
    let hoveredItem = $state<{ type: 'built-skill'; id: string } | null>(null);
    let tooltipPos = $state({ x: 0, y: 0 });
    let tooltipVisible = $state(false);
    let hoverTimeout: ReturnType<typeof setTimeout> | null = null;
    let showTimeout: ReturnType<typeof setTimeout> | null = null;

    function showPopover(type: 'built-skill', id: string, e: MouseEvent) {
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
    const totalSelected = $derived(selectedBuiltSkillIds.length);

    // ── Fetch models + skills + tools when gateway connects ────────────────
    let modelsLoaded = $state(false);
    let builtSkillsLoaded = $state(false);

    $effect(() => {
        if (!builtSkillsLoaded) {
            // Mark the request as started synchronously so reactive reruns do not
            // launch duplicate list requests while the first one is in flight.
            builtSkillsLoaded = true;
            skillsLoading = true;
            fetchJson<{ skills: BuiltSkill[] }>('/api/builder/skills?status=published')
                .then((data) => {
                    publishedSkills = data.skills ?? [];
                })
                .catch(() => {})
                .finally(() => {
                    skillsLoading = false;
                });
        }
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
    });

    // ── Toggles ─────────────────────────────────────────────────────────────
    function toggleBuiltSkill(skillId: string) {
        if (selectedBuiltSkillIds.includes(skillId)) {
            selectedBuiltSkillIds = selectedBuiltSkillIds.filter((k) => k !== skillId);
        } else {
            selectedBuiltSkillIds = [...selectedBuiltSkillIds, skillId];
        }
    }

    // ── Popover data helpers ────────────────────────────────────────────────
    function getPopoverData() {
        if (!hoveredItem) return null;
        if (hoveredItem.type === 'built-skill') {
            const s = publishedSkills.find((sk) => sk.id === hoveredItem!.id);
            if (!s) return null;
            return { emoji: s.emoji || '\u{1F4D6}', name: s.name, desc: s.description, badge: 'custom' };
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
        let createdDraftId: string | null = null;
        try {
            // Draft-first: authoring state is persisted before any gateway mutation.
            const { id: agentId } = await fetchJson<{ id: string }>('/api/builder/agents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: name.trim(),
                    emoji: emoji.trim(),
                    model: model.trim() || undefined,
                    serverId: hostsState.activeHostId || undefined,
                }),
            });
            createdDraftId = agentId;

            for (const skillId of selectedBuiltSkillIds) {
                await fetchJson<{ ok: boolean }>(`/api/builder/agents/${agentId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'add-skill', skillId }),
                });
            }
            onComplete(agentId);
        } catch (err) {
            // Skill attachment is part of the create operation. If it fails,
            // remove the incomplete authoring draft so retrying cannot create
            // duplicate drafts. No runtime agent exists at this point.
            if (createdDraftId) {
                try {
                    await fetchJson(`/api/builder/agents/${createdDraftId}`, { method: 'DELETE' });
                } catch (cleanupError) {
                    console.error('Incomplete agent draft cleanup failed:', cleanupError);
                }
            }
            console.error('Agent creation failed:', err);
            toastError(m.common_error(), err instanceof Error ? err.message : m.common_retry());
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
            <Button variant="ghost"
                class="close-btn"
                onclick={onClose}
                aria-label={m.common_close()}
            >
                <X size={16} />
            </Button>
        </div>

        <!-- Step indicator -->
        <div class="steps-root" {...api.getRootProps()}>
            <div class="steps-list" {...api.getListProps()}>
                {#each stepsData as stepData, index (index)}
                    <div class="step-item" {...api.getItemProps({ index })}>
                        <Button variant="ghost"
                            {...normalizeButtonProps(api.getTriggerProps({ index }))}
                            class="step-trigger"
                        >
                            <span class="step-indicator" {...api.getIndicatorProps({ index })}>
                                {#if api.getItemState({ index }).completed}
                                    <Check size={12} />
                                {:else}
                                    {index + 1}
                                {/if}
                            </span>
                            <span class="step-label">{stepData.title}</span>
                        </Button>
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
                    {publishedSkills}
                    {selectedBuiltSkillIds}
                    {totalSelected}
                    {emoji}
                    {name}
                    {model}
                    {hoveredItem}
                    {tooltipPos}
                    {tooltipVisible}
                    {popoverData}
                    {toggleBuiltSkill}
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
                    <Button variant="ghost"
                        {...normalizeButtonProps(api.getPrevTriggerProps())}
                        class="btn btn--ghost"
                    >
                        <ChevronLeft size={14} />
                        {m.common_back()}
                    </Button>
                {/if}
            </div>

            <span class="step-counter">
                {m.marketplace_wizardStepOf({ step: api.value + 1, total: STEP_COUNT })}
            </span>

            <div class="footer-right">
                <Button variant="ghost"
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
                </Button>
            </div>
        </div>
    </div>
</div>

<style>
    /* ── Overlay ─────────────────────────────────────────────────────────── */
    .overlay {
        position: fixed;
        inset: 0;
        z-index: var(--layer-debug);
        background: color-mix(in srgb, var(--color-canvas) 60%, transparent);
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
        border-radius: var(--radius-lg);
        width: 100%;
        max-width: 480px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: var(--shadow-elevation-1);
    }

    .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-4) var(--space-6);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
        gap: var(--space-2);
    }

    .modal-title-row {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        color: var(--color-foreground);
    }

    .modal-title {
        font-size: var(--font-size-page-title);
        font-weight: 700;
        color: var(--color-foreground);
    }

    .close-btn {
        background: transparent;
        border: none;
        color: var(--color-muted);
        cursor: pointer;
        padding: var(--space-1);
        border-radius: var(--radius-sm);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color var(--duration-fast);
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
        padding: var(--space-3) var(--space-6);
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
        gap: var(--space-2);
        background: transparent;
        border: none;
        cursor: pointer;
        padding: var(--space-0-5);
        border-radius: var(--radius-sm);
        white-space: nowrap;
        transition: opacity var(--duration-fast);
    }
    .step-trigger:hover {
        opacity: 0.8;
    }

    .step-indicator {
        width: 22px;
        height: 22px;
        border-radius: var(--radius-full);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: var(--font-size-caption);
        font-weight: 600;
        flex-shrink: 0;
        border: 1.5px solid var(--color-border);
        color: var(--color-muted);
        background: var(--color-bg2);
        transition: all var(--duration-normal);
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
        font-size: var(--font-size-caption);
        color: var(--color-muted);
        transition: color var(--duration-fast);
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
        margin: 0 var(--space-2);
        min-width: 12px;
    }

    .step-trigger[data-complete] ~ .step-separator {
        background: var(--color-accent);
    }

    /* ── Step content ────────────────────────────────────────────────────── */
    .step-content-area {
        flex: 1;
        overflow-y: auto;
        padding: var(--space-6);
        min-height: 0;
        position: relative;
        z-index: var(--layer-base);
    }

    .step-content-area > :global([data-state="closed"]) {
        display: none;
    }

    /* ── Footer ──────────────────────────────────────────────────────────── */
    .modal-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--space-3) var(--space-6);
        border-top: 1px solid var(--color-border);
        flex-shrink: 0;
        position: relative;
        z-index: var(--layer-base);
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
        font-size: var(--font-size-caption);
        color: var(--color-muted);
        flex-shrink: 0;
    }

    /* ── Buttons ──────────────────────────────────────────────────────────── */
    .btn {
        display: inline-flex;
        align-items: center;
        gap: var(--space-1);
        font-family: inherit;
        font-size: var(--font-size-caption);
        font-weight: 600;
        padding: var(--space-2) var(--space-3);
        border-radius: var(--radius-md);
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
