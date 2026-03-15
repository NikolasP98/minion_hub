<script lang="ts">
    import { page } from "$app/state";
    import Topbar from "$lib/components/layout/Topbar.svelte";
    import { ArrowLeft, Bot, Eye, Grip, Loader2, Check, Upload, Circle, Plus, X, BookOpen } from "lucide-svelte";
    import { onMount } from "svelte";
    import EmojiPicker from "$lib/components/builder/EmojiPicker.svelte";

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
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

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
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveAgent(), 2000);
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

<div class="relative z-10 flex flex-col h-screen overflow-hidden text-foreground">
    <Topbar />

    <!-- Editor Toolbar -->
    <div class="editor-toolbar">
        <div class="flex items-center gap-3 min-w-0">
            <a href="/builder" class="back-link" title="Back to Builder">
                <ArrowLeft size={16} />
            </a>

            <div class="h-5 w-px bg-border/60 shrink-0"></div>

            <div class="flex items-center gap-2 min-w-0">
                <Bot size={16} class="text-accent shrink-0" />
                <span class="text-sm font-semibold text-foreground truncate">
                    {name}
                </span>
                <span class="status-badge {status}">
                    {status}
                </span>
            </div>
        </div>

        <div class="flex items-center gap-2">
            <span class="save-indicator" title={saving ? 'Saving changes...' : dirty ? 'Unsaved changes' : 'All changes saved'}>
                {#if saving}
                    <Loader2 size={12} class="loading-spinner" />
                    <span>Saving...</span>
                {:else if dirty}
                    <Circle size={8} class="dirty-dot" />
                    <span>Unsaved</span>
                {:else}
                    <Check size={12} class="saved-check" />
                    <span>Saved</span>
                {/if}
            </span>

            <div class="h-4 w-px bg-border/60"></div>

            <button type="button" class="toolbar-btn secondary" title="Preview">
                <Eye size={14} />
                <span class="hidden sm:inline">Preview</span>
            </button>
            <button
                type="button"
                class="toolbar-btn {status === 'published' ? 'published' : 'primary'}"
                onclick={publishAgent}
                disabled={publishing}
                title={status === 'published' ? 'Republish with latest changes' : 'Publish agent'}
            >
                {#if publishing}
                    <Loader2 size={14} class="loading-spinner" />
                {:else}
                    <Upload size={14} />
                {/if}
                <span class="hidden sm:inline">{publishing ? 'Publishing...' : status === 'published' ? 'Republish' : 'Publish'}</span>
            </button>
        </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 min-h-0 overflow-y-auto">
        {#if loading}
            <div class="loading-container">
                <Loader2 size={24} class="loading-spinner" />
                <span class="loading-text">Loading agent...</span>
            </div>
        {:else}
            <div class="editor-scroll">
                <div class="editor-card">

                    <!-- Section 1: Identity -->
                    <section class="editor-section">
                        <h3 class="section-header">Identity</h3>
                        <div class="section-body">
                            <EmojiPicker value={emoji} onSelect={(e) => { emoji = e; }} />

                            <input
                                type="text"
                                class="name-input"
                                bind:value={name}
                                placeholder="Agent name"
                            />

                            <textarea
                                class="desc-input"
                                bind:value={description}
                                placeholder="Describe what this agent does..."
                                rows="3"
                            ></textarea>
                        </div>
                    </section>

                    <!-- Section 2: Model & Prompt -->
                    <section class="editor-section">
                        <h3 class="section-header">Model & Prompt</h3>
                        <div class="section-body">
                            <div class="field-group">
                                <label class="field-label" for="model-input">Model</label>
                                <input
                                    id="model-input"
                                    type="text"
                                    class="field-input"
                                    bind:value={model}
                                    placeholder="e.g. claude-sonnet-4, gpt-4o"
                                />
                            </div>

                            <div class="field-group">
                                <label class="field-label" for="system-prompt">System Prompt</label>
                                <p class="field-helper">Define the agent's personality, role, and behavioral guidelines</p>
                                <textarea
                                    id="system-prompt"
                                    class="prompt-input"
                                    bind:value={systemPrompt}
                                    placeholder="You are a helpful assistant that..."
                                    rows="8"
                                ></textarea>
                            </div>
                        </div>
                    </section>

                    <!-- Section 3: Skills -->
                    <section class="editor-section">
                        <h3 class="section-header">
                            Skill Slots
                            <span class="section-count">{skillSlots.length}</span>
                        </h3>
                        <div class="section-body">
                            {#if assignedSkillInfos.length > 0}
                                <div class="skill-slot-list">
                                    {#each assignedSkillInfos as slot, i (slot.skillId)}
                                        <div
                                            class="skill-slot-card"
                                            class:drag-over={dragOverIdx === i}
                                            draggable="true"
                                            role="listitem"
                                            ondragstart={(e) => handleSlotDragStart(e, i)}
                                            ondragover={(e) => handleSlotDragOver(e, i)}
                                            ondragleave={handleSlotDragLeave}
                                            ondrop={(e) => handleSlotDrop(e, i)}
                                            ondragend={handleSlotDragEnd}
                                        >
                                            <span class="slot-grip" title="Drag to reorder">
                                                <Grip size={14} />
                                            </span>
                                            <span class="slot-emoji">{slot.info?.emoji ?? "\u{1F4D6}"}</span>
                                            <div class="slot-info">
                                                <span class="slot-name">{slot.info?.name ?? slot.skillId}</span>
                                                {#if slot.info}
                                                    <span class="slot-status {slot.info.status}">{slot.info.status}</span>
                                                {/if}
                                            </div>
                                            <button
                                                type="button"
                                                class="slot-remove"
                                                onclick={() => removeSkillSlot(slot.skillId)}
                                                title="Remove skill"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    {/each}
                                </div>
                            {/if}

                            <!-- Drop zone / Add skill button -->
                            <div class="skill-drop-zone-wrapper">
                                <button
                                    type="button"
                                    class="skill-drop-zone"
                                    onclick={() => { showSkillPicker = !showSkillPicker; }}
                                >
                                    <Plus size={14} />
                                    <span>Drop a skill here or click to browse</span>
                                </button>

                                {#if showSkillPicker}
                                    <div class="skill-picker">
                                        <div class="skill-picker-header">
                                            <BookOpen size={12} />
                                            <span>Published Skills</span>
                                        </div>
                                        {#if pickableSkills.length === 0}
                                            <div class="skill-picker-empty">
                                                No published skills available
                                            </div>
                                        {:else}
                                            {#each pickableSkills as skill (skill.id)}
                                                <button
                                                    type="button"
                                                    class="skill-picker-item"
                                                    onclick={() => addSkillSlot(skill.id)}
                                                >
                                                    <span class="picker-emoji">{skill.emoji || "\u{1F4D6}"}</span>
                                                    <div class="picker-info">
                                                        <span class="picker-name">{skill.name}</span>
                                                        {#if skill.description}
                                                            <span class="picker-desc">{skill.description}</span>
                                                        {/if}
                                                    </div>
                                                </button>
                                            {/each}
                                        {/if}
                                    </div>
                                {/if}

                                {#if availableSkills.filter(s => assignedSkillIds.has(s.id)).length > 0 && showSkillPicker}
                                    <!-- Already assigned skills shown grayed out -->
                                    <div class="skill-picker-assigned">
                                        <div class="skill-picker-header muted">
                                            <span>Already assigned</span>
                                        </div>
                                        {#each availableSkills.filter(s => assignedSkillIds.has(s.id)) as skill (skill.id)}
                                            <div class="skill-picker-item disabled">
                                                <span class="picker-emoji">{skill.emoji || "\u{1F4D6}"}</span>
                                                <div class="picker-info">
                                                    <span class="picker-name">{skill.name}</span>
                                                </div>
                                            </div>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                        </div>
                    </section>

                    <!-- Section 4: Behavior -->
                    <section class="editor-section">
                        <h3 class="section-header">Behavior</h3>
                        <div class="section-body">
                            <div class="field-group">
                                <label class="field-label" for="temperature-input">Temperature</label>
                                <div class="range-row">
                                    <input
                                        id="temperature-input"
                                        type="range"
                                        class="range-input"
                                        bind:value={temperature}
                                        min="0"
                                        max="1"
                                        step="0.1"
                                    />
                                    <span class="range-value">{temperature.toFixed(1)}</span>
                                </div>
                            </div>

                            <div class="field-group">
                                <label class="field-label" for="max-tokens-input">Max Tokens</label>
                                <input
                                    id="max-tokens-input"
                                    type="number"
                                    class="field-input"
                                    bind:value={maxTokens}
                                    min="1"
                                    max="200000"
                                    step="256"
                                />
                            </div>

                            <div class="field-group">
                                <label class="field-label" for="retry-input">Retry Count</label>
                                <input
                                    id="retry-input"
                                    type="number"
                                    class="field-input"
                                    bind:value={retryCount}
                                    min="0"
                                    max="10"
                                />
                            </div>

                            <div class="field-group">
                                <label class="field-label" for="fallback-input">Fallback Agent</label>
                                <input
                                    id="fallback-input"
                                    type="text"
                                    class="field-input"
                                    bind:value={fallbackAgentId}
                                    placeholder="Agent ID (optional)"
                                />
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        {/if}
    </div>
</div>

<!-- Click outside to close skill picker -->
{#if showSkillPicker}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="picker-backdrop" onclick={() => { showSkillPicker = false; }} onkeydown={(e) => { if (e.key === 'Escape') showSkillPicker = false; }}></div>
{/if}

<style>
    /* ── Editor Toolbar ──────────────────────────────────────────────── */
    .editor-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 2.75rem;
        padding: 0 0.75rem;
        background: var(--color-bg2);
        border-bottom: 1px solid var(--color-border);
        flex-shrink: 0;
    }

    .back-link {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: 0.375rem;
        color: var(--color-muted);
        transition: all 0.15s ease;
    }

    .back-link:hover {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }

    .status-badge {
        display: inline-flex;
        align-items: center;
        padding: 0.125rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        flex-shrink: 0;
    }

    .status-badge.draft {
        color: var(--color-warning);
        background: color-mix(in srgb, var(--color-warning) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-warning) 25%, transparent);
    }

    .status-badge.published {
        color: var(--color-success);
        background: color-mix(in srgb, var(--color-success) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-success) 25%, transparent);
    }

    .toolbar-btn {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.375rem 0.625rem;
        border-radius: 0.375rem;
        font-size: 0.75rem;
        font-weight: 500;
        border: none;
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
    }

    .toolbar-btn.secondary {
        color: var(--color-muted);
        background: transparent;
        border: 1px solid var(--color-border);
    }

    .toolbar-btn.secondary:hover {
        color: var(--color-foreground);
        background: var(--color-bg3);
    }

    .toolbar-btn.primary {
        color: white;
        background: var(--color-accent);
    }

    .toolbar-btn.primary:hover {
        filter: brightness(1.1);
    }

    .toolbar-btn.published {
        color: var(--color-success, #22c55e);
        background: color-mix(in srgb, var(--color-success, #22c55e) 12%, transparent);
        border: 1px solid color-mix(in srgb, var(--color-success, #22c55e) 25%, transparent);
    }

    .toolbar-btn.published:hover {
        background: color-mix(in srgb, var(--color-success, #22c55e) 20%, transparent);
    }

    /* ── Save Indicator ────────────────────────────────────────────── */
    .save-indicator {
        display: flex;
        align-items: center;
        gap: 0.3125rem;
        font-size: 0.6875rem;
        color: var(--color-muted);
        white-space: nowrap;
        padding: 0.25rem 0.5rem;
        border-radius: 0.375rem;
        user-select: none;
    }

    :global(.loading-spinner) {
        color: var(--color-muted);
        animation: spin 1s linear infinite;
    }

    :global(.dirty-dot) {
        color: var(--color-warning, #f59e0b);
        fill: var(--color-warning, #f59e0b);
    }

    :global(.saved-check) {
        color: var(--color-success, #22c55e);
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

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

    /* ── Sections ────────────────────────────────────────────────── */
    .editor-section {
        background: var(--color-bg2);
        border: 1px solid var(--color-border);
        border-radius: 0.75rem;
        overflow: hidden;
    }

    .section-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        margin: 0;
        font-size: 0.6875rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
        border-bottom: 1px solid var(--color-border);
    }

    .section-count {
        font-size: 0.5625rem;
        color: var(--color-muted);
        background: var(--color-bg3);
        padding: 0.0625rem 0.375rem;
        border-radius: 9999px;
        font-weight: 500;
    }

    .section-body {
        padding: 1rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    /* ── Emoji Picker ────────────────────────────────────────────── */
    .emoji-picker {
        width: 3.5rem;
        height: 3.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 0.75rem;
        border: 2px dashed var(--color-border);
        background: var(--color-bg3);
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .emoji-picker:hover {
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 6%, transparent);
    }

    .emoji-display {
        font-size: 1.75rem;
        line-height: 1;
    }

    /* ── Name Input ──────────────────────────────────────────────── */
    .name-input {
        width: 100%;
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--color-foreground);
        background: transparent;
        border: none;
        border-bottom: 2px solid transparent;
        padding: 0.25rem 0;
        outline: none;
        font-family: inherit;
        transition: border-color 0.15s ease;
    }

    .name-input:focus {
        border-bottom-color: var(--color-accent);
    }

    .name-input::placeholder {
        color: var(--color-muted);
    }

    /* ── Description Textarea ────────────────────────────────────── */
    .desc-input {
        width: 100%;
        font-size: 0.8125rem;
        color: var(--color-foreground);
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        padding: 0.625rem 0.75rem;
        outline: none;
        resize: vertical;
        font-family: inherit;
        line-height: 1.5;
        transition: border-color 0.15s ease;
    }

    .desc-input:focus {
        border-color: var(--color-accent);
    }

    .desc-input::placeholder {
        color: var(--color-muted);
    }

    /* ── Field Groups ────────────────────────────────────────────── */
    .field-group {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .field-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--color-foreground);
    }

    .field-helper {
        font-size: 0.6875rem;
        color: var(--color-muted);
        margin: 0;
        line-height: 1.4;
    }

    .field-input {
        width: 100%;
        font-size: 0.8125rem;
        color: var(--color-foreground);
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        padding: 0.5rem 0.75rem;
        outline: none;
        font-family: inherit;
        transition: border-color 0.15s ease;
    }

    .field-input:focus {
        border-color: var(--color-accent);
    }

    .field-input::placeholder {
        color: var(--color-muted);
    }

    /* ── System Prompt Textarea ──────────────────────────────────── */
    .prompt-input {
        width: 100%;
        font-size: 0.8125rem;
        color: var(--color-foreground);
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        padding: 0.625rem 0.75rem;
        outline: none;
        resize: vertical;
        font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
        line-height: 1.6;
        transition: border-color 0.15s ease;
    }

    .prompt-input:focus {
        border-color: var(--color-accent);
    }

    .prompt-input::placeholder {
        color: var(--color-muted);
        font-family: inherit;
    }

    /* ── Skill Slots ─────────────────────────────────────────────── */
    .skill-slot-list {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
    }

    .skill-slot-card {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.625rem;
        background: var(--color-bg3);
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        transition: all 0.15s ease;
        cursor: grab;
    }

    .skill-slot-card:active {
        cursor: grabbing;
    }

    .skill-slot-card:hover {
        border-color: color-mix(in srgb, var(--color-accent) 40%, var(--color-border));
    }

    .skill-slot-card.drag-over {
        border-color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 6%, transparent);
    }

    .slot-grip {
        display: flex;
        align-items: center;
        color: var(--color-muted);
        opacity: 0.5;
        flex-shrink: 0;
    }

    .skill-slot-card:hover .slot-grip {
        opacity: 1;
    }

    .slot-emoji {
        font-size: 1rem;
        line-height: 1;
        flex-shrink: 0;
    }

    .slot-info {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }

    .slot-name {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--color-foreground);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .slot-status {
        font-size: 0.5625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 0.0625rem 0.375rem;
        border-radius: 9999px;
        flex-shrink: 0;
    }

    .slot-status.draft {
        color: var(--color-warning);
        background: color-mix(in srgb, var(--color-warning) 12%, transparent);
    }

    .slot-status.published {
        color: var(--color-success);
        background: color-mix(in srgb, var(--color-success) 12%, transparent);
    }

    .slot-remove {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.5rem;
        height: 1.5rem;
        border-radius: 0.25rem;
        color: var(--color-muted);
        background: none;
        border: none;
        cursor: pointer;
        transition: all 0.1s ease;
        font-family: inherit;
        flex-shrink: 0;
        opacity: 0;
    }

    .skill-slot-card:hover .slot-remove {
        opacity: 1;
    }

    .slot-remove:hover {
        color: var(--color-error, #ef4444);
        background: color-mix(in srgb, var(--color-error, #ef4444) 12%, transparent);
    }

    /* ── Skill Drop Zone ─────────────────────────────────────────── */
    .skill-drop-zone-wrapper {
        position: relative;
    }

    .skill-drop-zone {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        width: 100%;
        padding: 0.75rem;
        border: 2px dashed var(--color-border);
        border-radius: 0.5rem;
        background: transparent;
        color: var(--color-muted);
        font-size: 0.75rem;
        font-family: inherit;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .skill-drop-zone:hover {
        border-color: var(--color-accent);
        color: var(--color-accent);
        background: color-mix(in srgb, var(--color-accent) 4%, transparent);
    }

    /* ── Skill Picker Dropdown ───────────────────────────────────── */
    .skill-picker {
        position: absolute;
        top: calc(100% + 0.375rem);
        left: 0;
        right: 0;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 0.5rem;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        max-height: 16rem;
        overflow-y: auto;
        z-index: 100;
    }

    .skill-picker-header {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 0.75rem;
        font-size: 0.625rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-muted);
        border-bottom: 1px solid var(--color-border);
    }

    .skill-picker-header.muted {
        opacity: 0.6;
    }

    .skill-picker-empty {
        padding: 1rem 0.75rem;
        font-size: 0.75rem;
        color: var(--color-muted);
        text-align: center;
    }

    .skill-picker-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        width: 100%;
        padding: 0.5rem 0.75rem;
        background: none;
        border: none;
        cursor: pointer;
        text-align: left;
        font-family: inherit;
        transition: background 0.1s ease;
        color: inherit;
    }

    .skill-picker-item:hover {
        background: var(--color-bg2);
    }

    .skill-picker-item.disabled {
        opacity: 0.4;
        cursor: not-allowed;
        pointer-events: none;
    }

    .picker-emoji {
        font-size: 0.9375rem;
        line-height: 1;
        flex-shrink: 0;
    }

    .picker-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
    }

    .picker-name {
        font-size: 0.75rem;
        font-weight: 600;
        color: var(--color-foreground);
    }

    .picker-desc {
        font-size: 0.625rem;
        color: var(--color-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .skill-picker-assigned {
        position: absolute;
        left: 0;
        right: 0;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-top: none;
        border-radius: 0 0 0.5rem 0.5rem;
        z-index: 100;
    }

    /* ── Picker Backdrop ─────────────────────────────────────────── */
    .picker-backdrop {
        position: fixed;
        inset: 0;
        z-index: 50;
    }

    /* ── Range Input (Temperature) ───────────────────────────────── */
    .range-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .range-input {
        flex: 1;
        height: 4px;
        accent-color: var(--color-accent);
        cursor: pointer;
    }

    .range-value {
        font-size: 0.8125rem;
        font-weight: 600;
        color: var(--color-foreground);
        min-width: 2rem;
        text-align: right;
        font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    }
</style>
