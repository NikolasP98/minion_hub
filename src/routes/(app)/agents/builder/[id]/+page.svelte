<script lang="ts">
    import { page } from "$app/state";
    import { Loader2 } from "lucide-svelte";
    import { onMount } from "svelte";
    import { createAutoSave } from "$lib/state/async.svelte";
    import * as m from '$lib/paraglide/messages';
    import BuilderToolbar from "./_components/BuilderToolbar.svelte";
    import IdentitySection from "./_components/IdentitySection.svelte";
    import ModelPromptSection from "./_components/ModelPromptSection.svelte";
    import SkillsSection from "./_components/SkillsSection.svelte";
    import BehaviorSection from "./_components/BehaviorSection.svelte";

    const agentId = $derived(page.params.id);

    // ── Form state ──────────────────────────────────────────────────────
    let name = $state("Untitled Agent");
    let emoji = $state("\u{1F916}");
    let description = $state("");
    let model = $state("");
    let systemPrompt = $state("");
    let temperature = $state(0.7);
    let maxTokens = $state(4096);
    let retryCount = $state(3);
    let fallbackAgentId = $state("");
    let status: "draft" | "published" = $state("draft");
    let loading = $state(true);
    let saving = $state(false);
    let dirty = $state(false);
    let publishing = $state(false);
    const autoSave = createAutoSave(() => saveAgent(), 2000);

    // ── Skill slots ─────────────────────────────────────────────────────
    interface SkillSlot { skillId: string; position: number; }
    interface SkillInfo { id: string; name: string; emoji: string; status: string; description: string; }
    let skillSlots = $state<SkillSlot[]>([]);
    let availableSkills = $state<SkillInfo[]>([]);
    let showSkillPicker = $state(false);

    // ── Drag reorder state ──────────────────────────────────────────────
    let dragIdx = $state<number | null>(null);
    let dragOverIdx = $state<number | null>(null);

    // ── Derived: skill info lookup for assigned skills ──────────────────
    const assignedSkillIds = $derived(new Set(skillSlots.map(s => s.skillId)));
    const assignedSkillInfos = $derived(
        skillSlots.map(slot => {
            const info = availableSkills.find(s => s.id === slot.skillId);
            return { ...slot, info };
        })
    );
    const pickableSkills = $derived(
        availableSkills.filter(s => s.status === 'published' && !assignedSkillIds.has(s.id))
    );

    // ── Load agent data ─────────────────────────────────────────────────
    async function loadAgent() {
        loading = true;
        try {
            const res = await fetch(`/api/builder/agents/${agentId}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const a = data.agent;
            name = a.name;
            emoji = a.emoji ?? "\u{1F916}";
            description = a.description ?? "";
            model = a.model ?? "";
            systemPrompt = a.systemPrompt ?? "";
            temperature = a.temperature ?? 0.7;
            maxTokens = a.maxTokens ?? 4096;
            fallbackAgentId = a.fallbackAgentId ?? "";
            status = a.status;

            // Parse retry policy
            try {
                const rp = typeof a.retryPolicy === 'string' ? JSON.parse(a.retryPolicy) : (a.retryPolicy ?? {});
                retryCount = rp.count ?? 3;
            } catch {
                retryCount = 3;
            }

            skillSlots = data.skillSlots.map((s: { skillId: string; position: number }) => ({
                skillId: s.skillId,
                position: s.position,
            }));
        } catch (e) {
            console.error('[agent-editor] Failed to load:', e);
        } finally {
            loading = false;
        }
    }

    // ── Load available skills ───────────────────────────────────────────
    async function loadAvailableSkills() {
        try {
            const res = await fetch('/api/builder/skills');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            availableSkills = data.skills;
        } catch (e) {
            console.error('[agent-editor] Failed to load skills:', e);
        }
    }

    // ── Auto-save (debounced 2s) ────────────────────────────────────────
    function scheduleSave() {
        dirty = true;
        autoSave.schedule();
    }

    async function saveAgent() {
        saving = true;
        try {
            await fetch(`/api/builder/agents/${agentId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    emoji,
                    description,
                    model,
                    systemPrompt,
                    temperature,
                    maxTokens,
                    retryPolicy: { count: retryCount },
                    fallbackAgentId,
                }),
            });
            dirty = false;
        } catch (e) {
            console.error('[agent-editor] Save failed:', e);
        } finally {
            saving = false;
        }
    }

    // ── Publish ─────────────────────────────────────────────────────────
    async function publishAgent() {
        if (dirty) await saveAgent();
        publishing = true;
        try {
            await fetch(`/api/builder/agents/${agentId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'publish' }),
            });
            status = 'published';
        } catch (e) {
            console.error('[agent-editor] Publish failed:', e);
        } finally {
            publishing = false;
        }
    }

    // ── Skill slot actions ──────────────────────────────────────────────
    async function addSkillSlot(skillId: string) {
        if (assignedSkillIds.has(skillId)) return;
        const nextPos = skillSlots.length;
        skillSlots = [...skillSlots, { skillId, position: nextPos }];
        showSkillPicker = false;
        saving = true;
        try {
            await fetch(`/api/builder/agents/${agentId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'add-skill', skillId }),
            });
        } catch (e) {
            console.error('[agent-editor] Add skill failed:', e);
            skillSlots = skillSlots.filter(s => s.skillId !== skillId);
        } finally {
            saving = false;
        }
    }

    async function removeSkillSlot(skillId: string) {
        const prev = skillSlots;
        skillSlots = skillSlots.filter(s => s.skillId !== skillId);
        saving = true;
        try {
            await fetch(`/api/builder/agents/${agentId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'remove-skill', skillId }),
            });
        } catch (e) {
            console.error('[agent-editor] Remove skill failed:', e);
            skillSlots = prev;
        } finally {
            saving = false;
        }
    }

    // ── Drag reorder ────────────────────────────────────────────────────
    function handleSlotDragStart(e: DragEvent, idx: number) {
        dragIdx = idx;
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    }

    function handleSlotDragOver(e: DragEvent, idx: number) {
        e.preventDefault();
        dragOverIdx = idx;
    }

    function handleSlotDragLeave() {
        dragOverIdx = null;
    }

    async function handleSlotDrop(e: DragEvent, targetIdx: number) {
        e.preventDefault();
        dragOverIdx = null;
        if (dragIdx === null || dragIdx === targetIdx) { dragIdx = null; return; }
        const reordered = [...skillSlots];
        const [moved] = reordered.splice(dragIdx, 1);
        reordered.splice(targetIdx, 0, moved);
        skillSlots = reordered.map((s, i) => ({ ...s, position: i }));
        dragIdx = null;

        // Persist reorder
        try {
            await fetch(`/api/builder/agents/${agentId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reorder-skills', skillIds: skillSlots.map(s => s.skillId) }),
            });
        } catch (e) {
            console.error('[agent-editor] Reorder failed:', e);
        }
    }

    function handleSlotDragEnd() {
        dragIdx = null;
        dragOverIdx = null;
    }

    // ── Lifecycle ───────────────────────────────────────────────────────
    onMount(() => {
        loadAgent();
        loadAvailableSkills();
    });

    // Trigger auto-save on field changes
    $effect(() => {
        void name; void emoji; void description; void model;
        void systemPrompt; void temperature; void maxTokens;
        void retryCount; void fallbackAgentId;
        if (!loading) scheduleSave();
    });
</script>

<BuilderToolbar
    {name}
    {status}
    {saving}
    {dirty}
    {publishing}
    onPublish={publishAgent}
/>

<!-- Main Content -->
<div class="flex-1 min-h-0 overflow-y-auto">
    {#if loading}
        <div class="loading-container">
            <Loader2 size={24} class="loading-spinner" />
            <span class="loading-text">{m.builder_loadingAgent()}</span>
        </div>
    {:else}
        <div class="editor-scroll">
            <div class="editor-card">
                <IdentitySection bind:emoji bind:name bind:description />

                <ModelPromptSection bind:model bind:systemPrompt />

                <SkillsSection
                    {skillSlots}
                    {assignedSkillInfos}
                    {availableSkills}
                    {assignedSkillIds}
                    {pickableSkills}
                    {showSkillPicker}
                    {dragOverIdx}
                    onTogglePicker={() => { showSkillPicker = !showSkillPicker; }}
                    onAddSkill={addSkillSlot}
                    onRemoveSkill={removeSkillSlot}
                    onSlotDragStart={handleSlotDragStart}
                    onSlotDragOver={handleSlotDragOver}
                    onSlotDragLeave={handleSlotDragLeave}
                    onSlotDrop={handleSlotDrop}
                    onSlotDragEnd={handleSlotDragEnd}
                />

                <BehaviorSection
                    bind:temperature
                    bind:maxTokens
                    bind:retryCount
                    bind:fallbackAgentId
                />
            </div>
        </div>
    {/if}
</div>

<!-- Click outside to close skill picker -->
{#if showSkillPicker}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="picker-backdrop" onclick={() => { showSkillPicker = false; }} onkeydown={(e) => { if (e.key === 'Escape') showSkillPicker = false; }}></div>
{/if}

<style>
    /* ── Loading ─────────────────────────────────────────────────── */
    .loading-container {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 3rem 0;
        height: 100%;
    }

    .loading-text {
        font-size: 0.8125rem;
        color: var(--color-muted);
    }

    /* ── Editor Scroll & Card ────────────────────────────────────── */
    .editor-scroll {
        display: flex;
        justify-content: center;
        padding: 2rem 1.5rem 4rem;
    }

    .editor-card {
        width: 100%;
        max-width: 640px;
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
    }

    /* ── Picker Backdrop ─────────────────────────────────────────── */
    .picker-backdrop {
        position: fixed;
        inset: 0;
        z-index: 50;
    }
</style>
