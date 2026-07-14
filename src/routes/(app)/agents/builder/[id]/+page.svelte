<script lang="ts">
  import { page } from '$app/state';
  import { onMount, onDestroy } from 'svelte';
  import { createDebouncer } from '$lib/pacer/index.svelte';
  import * as m from '$lib/paraglide/messages';
  import BuilderToolbar from './_components/BuilderToolbar.svelte';
  import IdentitySection from './_components/IdentitySection.svelte';
  import ModelPromptSection from './_components/ModelPromptSection.svelte';
  import SkillsSection from './_components/SkillsSection.svelte';
  import BehaviorSection from './_components/BehaviorSection.svelte';
  import { fetchJson } from '$lib/api/fetch-json';
  import AsyncBoundary from '$lib/components/ui/foundations/AsyncBoundary.svelte';

  const agentId = $derived(page.params.id);

  // ── Form state ──────────────────────────────────────────────────────
  let name = $state('Untitled Agent');
  let emoji = $state('\u{1F916}');
  let description = $state('');
  let model = $state('');
  let systemPrompt = $state('');
  let temperature = $state(0.7);
  let maxTokens = $state(4096);
  let retryCount = $state(3);
  let fallbackAgentId = $state('');
  let status: 'draft' | 'published' = $state('draft');
  let loading = $state(true);
  let saving = $state(false);
  let dirty = $state(false);
  let publishing = $state(false);
  let errorMessage = $state('');
  let loadError = $state<string | null>(null);
  const autoSave = createDebouncer(() => saveAgent(), { wait: 2000 });

  // ── Skill slots ─────────────────────────────────────────────────────
  interface SkillSlot {
    skillId: string;
    position: number;
  }
  interface SkillInfo {
    id: string;
    name: string;
    emoji: string;
    status: string;
    description: string;
  }
  interface AgentPayload {
    name: string;
    emoji: string | null;
    description: string | null;
    model: string | null;
    systemPrompt: string | null;
    temperature: number | null;
    maxTokens: number | null;
    fallbackAgentId: string | null;
    retryPolicy: string | { count?: number } | null;
    runtimeAgentId: string | null;
    status: 'draft' | 'published';
  }
  let skillSlots = $state<SkillSlot[]>([]);
  let availableSkills = $state<SkillInfo[]>([]);
  let showSkillPicker = $state(false);

  // ── Drag reorder state ──────────────────────────────────────────────
  let dragIdx = $state<number | null>(null);
  let dragOverIdx = $state<number | null>(null);

  // ── Derived: skill info lookup for assigned skills ──────────────────
  const assignedSkillIds = $derived(new Set(skillSlots.map((s) => s.skillId)));
  const assignedSkillInfos = $derived(
    skillSlots.map((slot) => {
      const info = availableSkills.find((s) => s.id === slot.skillId);
      return { ...slot, info };
    }),
  );
  const pickableSkills = $derived(
    availableSkills.filter((s) => s.status === 'published' && !assignedSkillIds.has(s.id)),
  );

  // ── Load agent data ─────────────────────────────────────────────────
  async function loadAgent() {
    loading = true;
    loadError = null;
    try {
      const data = await fetchJson<{
        agent: AgentPayload;
        skillSlots: Array<{ skillId: string; position: number }>;
      }>(`/api/builder/agents/${agentId}`);
      const a = data.agent;
      name = a.name;
      emoji = a.emoji ?? '\u{1F916}';
      description = a.description ?? '';
      model = a.model ?? '';
      systemPrompt = a.systemPrompt ?? '';
      temperature = a.temperature ?? 0.7;
      maxTokens = a.maxTokens ?? 4096;
      fallbackAgentId = a.fallbackAgentId ?? '';
      status = a.status;

      // Parse retry policy
      try {
        const rp =
          typeof a.retryPolicy === 'string' ? JSON.parse(a.retryPolicy) : (a.retryPolicy ?? {});
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
      loadError = e instanceof Error ? e.message : m.common_error();
    } finally {
      loading = false;
    }
  }

  // ── Load available skills ───────────────────────────────────────────
  async function loadAvailableSkills() {
    try {
      const data = await fetchJson<{ skills: SkillInfo[] }>('/api/builder/skills');
      availableSkills = data.skills;
    } catch (e) {
      console.error('[agent-editor] Failed to load skills:', e);
    }
  }

  // ── Auto-save (debounced 2s) ────────────────────────────────────────
  function scheduleSave() {
    dirty = true;
    autoSave.run();
  }

  async function saveAgent(): Promise<boolean> {
    saving = true;
    errorMessage = '';
    try {
      await fetchJson<{ ok: boolean }>(`/api/builder/agents/${agentId}`, {
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
      return true;
    } catch (e) {
      console.error('[agent-editor] Save failed:', e);
      errorMessage = e instanceof Error ? e.message : m.common_error();
      return false;
    } finally {
      saving = false;
    }
  }

  // ── Publish ─────────────────────────────────────────────────────────
  async function publishAgent() {
    if (dirty && !(await saveAgent())) return;
    publishing = true;
    errorMessage = '';
    try {
      await fetchJson<{ ok: boolean }>(`/api/builder/agents/${agentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish' }),
      });
      status = 'published';
    } catch (e) {
      console.error('[agent-editor] Publish failed:', e);
      errorMessage = e instanceof Error ? e.message : m.builder_publishFailed();
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
      await fetchJson<{ ok: boolean }>(`/api/builder/agents/${agentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-skill', skillId }),
      });
    } catch (e) {
      console.error('[agent-editor] Add skill failed:', e);
      skillSlots = skillSlots.filter((s) => s.skillId !== skillId);
      errorMessage = e instanceof Error ? e.message : m.common_error();
    } finally {
      saving = false;
    }
  }

  async function removeSkillSlot(skillId: string) {
    const prev = skillSlots;
    skillSlots = skillSlots.filter((s) => s.skillId !== skillId);
    saving = true;
    try {
      await fetchJson<{ ok: boolean }>(`/api/builder/agents/${agentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove-skill', skillId }),
      });
    } catch (e) {
      console.error('[agent-editor] Remove skill failed:', e);
      skillSlots = prev;
      errorMessage = e instanceof Error ? e.message : m.common_error();
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
    if (dragIdx === null || dragIdx === targetIdx) {
      dragIdx = null;
      return;
    }
    const previous = skillSlots;
    const reordered = [...skillSlots];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(targetIdx, 0, moved);
    skillSlots = reordered.map((s, i) => ({ ...s, position: i }));
    dragIdx = null;

    // Persist reorder
    try {
      await fetchJson<{ ok: boolean }>(`/api/builder/agents/${agentId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reorder-skills',
          skillIds: skillSlots.map((s) => s.skillId),
        }),
      });
    } catch (e) {
      console.error('[agent-editor] Reorder failed:', e);
      skillSlots = previous;
      errorMessage = e instanceof Error ? e.message : m.common_error();
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
  onDestroy(() => autoSave.flush());

  // Trigger auto-save on field changes
  $effect(() => {
    void name;
    void emoji;
    void description;
    void model;
    void systemPrompt;
    void temperature;
    void maxTokens;
    void retryCount;
    void fallbackAgentId;
    if (!loading) scheduleSave();
  });
</script>

<BuilderToolbar {name} {status} {saving} {dirty} {publishing} onPublish={publishAgent} />

{#if errorMessage}
  <div class="mutation-error" role="alert">
    {errorMessage}
  </div>
{/if}

<!-- Main Content -->
<div class="editor-region">
  <AsyncBoundary
    state={loading
      ? { kind: 'loading', label: m.builder_loadingAgent() }
      : loadError
        ? { kind: 'error', title: m.common_error(), description: loadError, retry: loadAgent }
        : { kind: 'ready' }}
    class="builder-boundary"
  >
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
          onTogglePicker={() => {
            showSkillPicker = !showSkillPicker;
          }}
          onAddSkill={addSkillSlot}
          onRemoveSkill={removeSkillSlot}
          onSlotDragStart={handleSlotDragStart}
          onSlotDragOver={handleSlotDragOver}
          onSlotDragLeave={handleSlotDragLeave}
          onSlotDrop={handleSlotDrop}
          onSlotDragEnd={handleSlotDragEnd}
        />

        <BehaviorSection bind:temperature bind:maxTokens bind:retryCount bind:fallbackAgentId />
      </div>
    </div>
  </AsyncBoundary>
</div>

<!-- Click outside to close skill picker -->
{#if showSkillPicker}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="picker-backdrop"
    onclick={() => {
      showSkillPicker = false;
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') showSkillPicker = false;
    }}
  ></div>
{/if}

<style>
  .mutation-error {
    margin: var(--space-3) var(--space-3) 0;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--color-danger-border);
    border-radius: var(--radius-md);
    color: var(--color-danger-fg);
    background: var(--color-danger-surface);
    font-size: var(--font-size-caption);
    line-height: var(--line-height-compact);
  }

  .editor-region,
  :global(.builder-boundary) {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
  }

  .editor-scroll {
    display: flex;
    justify-content: center;
    padding: var(--space-page-section) var(--space-page-gutter) var(--space-12);
  }

  .editor-card {
    width: 100%;
    max-width: 640px;
    display: flex;
    flex-direction: column;
    gap: var(--space-section);
  }

  .picker-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--layer-modal);
  }

  @media (max-width: 767.98px) {
    .editor-scroll {
      padding-block: var(--space-section) var(--space-12);
    }
  }
</style>
