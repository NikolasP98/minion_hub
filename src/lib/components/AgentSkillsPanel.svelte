<script lang="ts">
  import {
    agentSkillsState,
    loadAgentSkills,
    setAgentSkills,
    toggleGlobalSkill,
  } from '$lib/state/agent-skills.svelte';
  import ToggleSwitch from './config/ToggleSwitch.svelte';

  let { agentId }: { agentId: string } = $props();

  let isCustomMode = $derived(agentSkillsState.agentFilter !== null);

  $effect(() => {
    loadAgentSkills(agentId);
  });

  function switchToCustom() {
    const enabledKeys = agentSkillsState.skills
      .filter((s) => s.eligible && !s.disabled)
      .map((s) => s.skillKey);
    setAgentSkills(agentId, enabledKeys);
  }

  function switchToAll() {
    setAgentSkills(agentId, null);
  }

  function handleToggle(skill: (typeof agentSkillsState.skills)[number], checked: boolean) {
    if (skill.always) return;

    if (isCustomMode && agentSkillsState.agentFilter) {
      const updated = checked
        ? [...agentSkillsState.agentFilter, skill.skillKey]
        : agentSkillsState.agentFilter.filter((k) => k !== skill.skillKey);
      setAgentSkills(agentId, updated);
    } else {
      toggleGlobalSkill(skill.skillKey, checked);
    }
  }

  function isChecked(skill: (typeof agentSkillsState.skills)[number]): boolean {
    if (skill.always) return true;
    if (isCustomMode) return skill.agentEnabled;
    return !skill.disabled;
  }

  function missingInfo(skill: (typeof agentSkillsState.skills)[number]): string {
    const parts: string[] = [];
    if (skill.missing.bins?.length) parts.push(`bins: ${skill.missing.bins.join(', ')}`);
    if (skill.missing.env?.length) parts.push(`env: ${skill.missing.env.join(', ')}`);
    if (skill.missing.configPaths?.length)
      parts.push(`config: ${skill.missing.configPaths.join(', ')}`);
    return parts.length ? `Missing: ${parts.join('; ')}` : '';
  }
</script>

<div class="bg-card border border-border rounded-lg overflow-hidden">
  <!-- Header / Filter Toggle -->
  <div class="flex items-center justify-between px-3 py-2 border-b border-border">
    <span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
      Skills
    </span>
    <div class="flex items-center gap-2">
      <button
        class="text-[10px] px-2 py-0.5 rounded-full border transition-colors
          {!isCustomMode
          ? 'bg-accent text-accent-foreground border-accent'
          : 'bg-bg3 text-muted-foreground border-border hover:border-accent/50'}"
        onclick={switchToAll}
      >
        All eligible
      </button>
      <button
        class="text-[10px] px-2 py-0.5 rounded-full border transition-colors
          {isCustomMode
          ? 'bg-accent text-accent-foreground border-accent'
          : 'bg-bg3 text-muted-foreground border-border hover:border-accent/50'}"
        onclick={switchToCustom}
      >
        Custom
      </button>
    </div>
  </div>

  <!-- Content -->
  {#if agentSkillsState.loading}
    <div class="flex items-center justify-center py-8">
      <div
        class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"
      ></div>
      <span class="ml-2 text-[11px] text-muted-foreground">Loading skills...</span>
    </div>
  {:else if agentSkillsState.error}
    <div class="px-3 py-4 text-[11px] text-red-400">
      {agentSkillsState.error}
    </div>
  {:else if agentSkillsState.skills.length === 0}
    <div class="px-3 py-4 text-[11px] text-muted-foreground">No skills available.</div>
  {:else}
    <div class="max-h-[360px] overflow-y-auto">
      {#each agentSkillsState.skills as skill (skill.skillKey)}
        {@const checked = isChecked(skill)}
        {@const locked = skill.always}
        {@const dimmed = !skill.eligible || skill.disabled}
        {@const missing = missingInfo(skill)}

        <div
          class="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 last:border-b-0
            {dimmed ? 'opacity-40' : ''}"
          title={missing || undefined}
        >
          <!-- Emoji -->
          {#if skill.emoji}
            <span class="text-sm shrink-0 w-5 text-center">{skill.emoji}</span>
          {:else}
            <span class="text-sm shrink-0 w-5 text-center text-muted-foreground">-</span>
          {/if}

          <!-- Name + Source + Description -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-[11px] text-foreground font-medium truncate">{skill.name}</span>
              <span
                class="shrink-0 bg-bg3 border border-border rounded-full px-1.5 text-[9px] text-muted-foreground leading-relaxed"
              >
                {skill.source}
              </span>
            </div>
            {#if skill.description}
              <p class="text-[10px] text-muted-foreground truncate leading-tight mt-0.5">
                {skill.description}
              </p>
            {/if}
            {#if !skill.eligible && missing}
              <p class="text-[9px] text-red-400/80 truncate leading-tight mt-0.5">
                {missing}
              </p>
            {/if}
          </div>

          <!-- Toggle -->
          <div class="shrink-0" class:pointer-events-none={locked || !skill.eligible}>
            <ToggleSwitch
              id="skill-{skill.skillKey}"
              {checked}
              onchange={(val) => handleToggle(skill, val)}
            />
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
