<script lang="ts">
  import { agentSkillsState, loadAgentSkills, setAgentSkills } from '$lib/state/agents/agent-skills.svelte';
  import type { SkillStatusEntry } from '$lib/types/skills';
  import * as m from '$lib/paraglide/messages';

  let { agentId }: { agentId: string } = $props();

  $effect(() => {
    loadAgentSkills(agentId);
  });

  let enabledSkills = $derived(agentSkillsState.skills.filter((s) => s.agentEnabled && !s.disabled));
  let disabledSkills = $derived(agentSkillsState.skills.filter((s) => !s.agentEnabled || s.disabled));

  let dragOverZone = $state<'enabled' | 'disabled' | null>(null);
  let draggedSkillKey = $state<string | null>(null);
  let tooltipOpen = $state(false);

  function onDragStart(e: DragEvent, skill: SkillStatusEntry) {
    if (skill.always) {
      e.preventDefault();
      return;
    }
    draggedSkillKey = skill.skillKey;
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData(
      'text/plain',
      JSON.stringify({ skillKey: skill.skillKey, enabled: skill.agentEnabled && !skill.disabled }),
    );
  }

  function onDragOver(e: DragEvent, zone: 'enabled' | 'disabled') {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    dragOverZone = zone;
  }

  function onDragLeave() {
    dragOverZone = null;
  }

  function onDrop(e: DragEvent, targetEnabled: boolean) {
    e.preventDefault();
    dragOverZone = null;
    draggedSkillKey = null;
    try {
      const data = JSON.parse(e.dataTransfer!.getData('text/plain'));
      const wasEnabled = data.enabled;
      if (wasEnabled !== targetEnabled) {
        const currentEnabled = agentSkillsState.skills
          .filter((s) => s.agentEnabled && !s.disabled)
          .map((s) => s.skillKey);
        let next: string[];
        if (targetEnabled) {
          next = [...currentEnabled, data.skillKey];
        } else {
          next = currentEnabled.filter((k: string) => k !== data.skillKey);
        }
        setAgentSkills(agentId, next.length > 0 ? next : null);
      }
    } catch {}
  }

  function onDragEnd() {
    dragOverZone = null;
    draggedSkillKey = null;
  }
</script>

<div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <h2 class="text-sm font-semibold text-foreground">{m.skills_title()}</h2>
      <div class="relative">
        <button
          type="button"
          class="w-4 h-4 rounded-full border border-border text-[9px] text-muted-foreground
            hover:border-accent/50 hover:text-foreground transition-colors cursor-help
            flex items-center justify-center"
          onclick={() => (tooltipOpen = !tooltipOpen)}
          onmouseenter={() => (tooltipOpen = true)}
          onmouseleave={() => (tooltipOpen = false)}
        >
          ?
        </button>
        {#if tooltipOpen}
          <div
            class="absolute left-6 top-0 z-50 w-64 rounded-lg border border-border bg-bg2
              shadow-lg px-3 py-2.5 text-[10px] text-muted-foreground leading-relaxed whitespace-pre-line"
          >
            {m.skills_tooltip()}
          </div>
        {/if}
      </div>
    </div>
    <div class="flex items-center gap-2">
      {#if agentSkillsState.skills.length > 0}
        <span class="text-[10px] text-muted-foreground">
          {enabledSkills.length}/{agentSkillsState.skills.length} enabled
        </span>
      {/if}
      <button
        class="text-[10px] px-2.5 py-1 rounded border border-border bg-bg3 text-muted-foreground
          hover:border-accent/50 hover:text-foreground transition-colors"
        disabled={agentSkillsState.loading}
        onclick={() => loadAgentSkills(agentId)}
      >
        {agentSkillsState.loading ? m.skills_loading() : m.skills_refresh()}
      </button>
    </div>
  </div>

  <p class="text-[10px] text-muted-foreground -mt-1">{m.skills_description()}</p>

  {#if agentSkillsState.loading && agentSkillsState.skills.length === 0}
    <div class="flex items-center justify-center py-8">
      <div class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
      <span class="ml-2 text-[11px] text-muted-foreground">{m.skills_loading()}</span>
    </div>
  {:else if agentSkillsState.error}
    <div class="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-[11px] text-red-400">
      {agentSkillsState.error}
    </div>
  {:else if agentSkillsState.skills.length === 0}
    <div class="text-[11px] text-muted-foreground py-4">{m.skills_noSkills()}</div>
  {:else}
    <div class="grid grid-cols-2 gap-3">
      <!-- Enabled zone -->
      <div
        class="rounded-lg border overflow-hidden transition-colors
          {dragOverZone === 'enabled'
          ? 'border-green-400/60 bg-green-500/10'
          : 'border-green-500/20 bg-green-500/5'}"
        role="list"
        ondragover={(e) => onDragOver(e, 'enabled')}
        ondragleave={onDragLeave}
        ondrop={(e) => onDrop(e, true)}
      >
        <div class="px-3 py-2 border-b border-green-500/20 flex items-center justify-between">
          <span class="text-[11px] font-semibold text-green-400 uppercase tracking-wider">
            {m.skills_enabled()}
          </span>
          <span class="text-[10px] text-green-400/70">{enabledSkills.length}</span>
        </div>
        <div class="max-h-[500px] overflow-y-auto p-1">
          {#each enabledSkills as skill (skill.skillKey)}
            {@render skillItem(skill)}
          {/each}
          {#if enabledSkills.length === 0}
            <div class="text-[10px] text-muted-foreground/50 text-center py-4">
              Drop skills here to enable
            </div>
          {/if}
        </div>
      </div>

      <!-- Disabled zone -->
      <div
        class="rounded-lg border overflow-hidden transition-colors
          {dragOverZone === 'disabled'
          ? 'border-muted-foreground/40 bg-bg3'
          : 'border-border bg-bg2'}"
        role="list"
        ondragover={(e) => onDragOver(e, 'disabled')}
        ondragleave={onDragLeave}
        ondrop={(e) => onDrop(e, false)}
      >
        <div class="px-3 py-2 border-b border-border flex items-center justify-between">
          <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            {m.skills_disabled()}
          </span>
          <span class="text-[10px] text-muted-foreground/70">{disabledSkills.length}</span>
        </div>
        <div class="max-h-[500px] overflow-y-auto p-1 opacity-60">
          {#each disabledSkills as skill (skill.skillKey)}
            {@render skillItem(skill)}
          {/each}
          {#if disabledSkills.length === 0}
            <div class="text-[10px] text-muted-foreground/50 text-center py-4">
              Drop skills here to disable
            </div>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

{#snippet skillItem(skill: SkillStatusEntry)}
  <div
    draggable={!skill.always}
    ondragstart={(e) => onDragStart(e, skill)}
    ondragend={onDragEnd}
    class="flex items-start gap-1.5 px-2 py-1.5 rounded-md transition-colors group
      {skill.always ? 'opacity-70 cursor-default' : 'cursor-grab active:cursor-grabbing hover:bg-white/5'}
      {draggedSkillKey === skill.skillKey ? 'opacity-30' : ''}"
    role="listitem"
  >
    <!-- Drag handle -->
    <span class="text-[10px] text-muted-foreground/40 group-hover:text-muted-foreground mt-0.5 shrink-0 select-none">
      {skill.always ? '' : '⠿'}
    </span>

    {#if skill.emoji}
      <span class="text-sm shrink-0 mt-0.5">{skill.emoji}</span>
    {/if}

    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1 flex-wrap">
        <span class="text-[10px] text-foreground font-medium truncate">{skill.name}</span>
        {#if skill.bundled}
          <span class="shrink-0 bg-accent/20 border border-accent/30 rounded-full px-1 text-[8px] text-accent leading-relaxed">
            bundled
          </span>
        {/if}
        {#if skill.always}
          <span class="shrink-0 bg-yellow-500/20 border border-yellow-500/30 rounded-full px-1 text-[8px] text-yellow-400 leading-relaxed">
            always
          </span>
        {/if}
      </div>
      {#if skill.description}
        <p class="text-[9px] text-muted-foreground mt-0.5 line-clamp-2">{skill.description}</p>
      {/if}
      {#if skill.missing?.bins?.length || skill.missing?.env?.length}
        <p class="text-[8px] text-red-400 mt-0.5">
          Missing: {[...(skill.missing.bins ?? []), ...(skill.missing.env ?? [])].join(', ')}
        </p>
      {/if}
    </div>
  </div>
{/snippet}
