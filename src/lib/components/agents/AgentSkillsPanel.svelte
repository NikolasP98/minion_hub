<script lang="ts">
  import { Button } from '$lib/components/ui';
import { agentSkillsState, loadAgentSkills, setAgentSkills } from '$lib/state/agents/agent-skills.svelte';
  import type { SkillStatusEntry } from '$lib/types/skills';
  import ToggleSwitch from '../config/ToggleSwitch.svelte';
  import * as m from '$lib/paraglide/messages';

  let { agentId }: { agentId: string } = $props();

  $effect(() => {
    loadAgentSkills(agentId);
  });

  let searchQuery = $state('');
  let filter = $state<'all' | 'enabled' | 'disabled'>('all');
  let missingBannerExpanded = $state(false);

  const enabledSkills = $derived(agentSkillsState.skills.filter((s) => s.agentEnabled && !s.disabled));
  const disabledSkills = $derived(agentSkillsState.skills.filter((s) => !s.agentEnabled || s.disabled));

  /** Skills with unmet dependencies */
  const skillsWithMissing = $derived(
    agentSkillsState.skills.filter(
      (s) => (s.missing?.bins?.length ?? 0) > 0 || (s.missing?.env?.length ?? 0) > 0,
    ),
  );

  /** Filtered + searched skills list */
  const visibleSkills = $derived.by(() => {
    let list = agentSkillsState.skills;

    // Apply filter tab
    if (filter === 'enabled') list = enabledSkills;
    else if (filter === 'disabled') list = disabledSkills;

    // Apply search
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.description ?? '').toLowerCase().includes(q) ||
          s.skillKey.toLowerCase().includes(q),
      );
    }

    return list;
  });

  function toggleSkill(skill: SkillStatusEntry, enabled: boolean) {
    const currentEnabled = agentSkillsState.skills
      .filter((s) => s.agentEnabled && !s.disabled)
      .map((s) => s.skillKey);

    let next: string[];
    if (enabled) {
      next = [...currentEnabled, skill.skillKey];
    } else {
      next = currentEnabled.filter((k) => k !== skill.skillKey);
    }
    setAgentSkills(agentId, next.length > 0 ? next : null);
  }
</script>

<div class="flex-1 min-h-0 flex flex-col">
  <!-- Header -->
  <div class="flex items-center justify-between mb-2">
    <div class="flex items-center gap-2">
      <h2 class="text-sm font-semibold text-foreground">{m.skills_title()}</h2>
      <span class="text-[length:var(--font-size-telemetry)] text-muted-foreground">
        {m.skills_enabledCount({ enabled: enabledSkills.length, total: agentSkillsState.skills.length })}
      </span>
    </div>
    <Button variant="ghost"
      class="text-[length:var(--font-size-telemetry)] px-2.5 py-1 rounded border border-border bg-bg3 text-muted-foreground
        hover:border-accent/50 hover:text-foreground transition-colors"
      disabled={agentSkillsState.loading}
      onclick={() => loadAgentSkills(agentId)}
    >
      {agentSkillsState.loading ? m.skills_loading() : m.skills_refresh()}
    </Button>
  </div>

  <p class="text-[length:var(--font-size-telemetry)] text-muted-foreground mb-3">{m.skills_description()}</p>

  <!-- Search + filter -->
  <div class="flex items-center gap-2 mb-3">
    <input
      type="text"
      bind:value={searchQuery}
      placeholder={m.skills_searchPlaceholder()}
      class="flex-1 bg-bg3 border border-border rounded-md text-[length:var(--font-size-caption)] text-foreground
        px-2.5 py-1.5 outline-none placeholder:text-muted-strong
        focus:border-accent/50 transition-colors"
    />
    <div class="flex rounded-md border border-border overflow-hidden shrink-0">
      {#each [
        { key: 'all', label: m.skills_filterAll(), count: agentSkillsState.skills.length },
        { key: 'enabled', label: m.skills_filterEnabled(), count: enabledSkills.length },
        { key: 'disabled', label: m.skills_filterDisabled(), count: disabledSkills.length },
      ] as tab (tab.key)}
        <Button variant="ghost"
          type="button"
          class="text-[length:var(--font-size-telemetry)] px-2 py-1 border-none cursor-pointer transition-colors
            {filter === tab.key
              ? 'bg-accent/15 text-accent font-medium'
              : 'bg-transparent text-muted-foreground hover:text-foreground hover:bg-bg3'}"
          onclick={() => (filter = tab.key as typeof filter)}
        >
          {tab.label}
          <span class="text-[length:var(--font-size-telemetry)] opacity-60 ml-0.5">{tab.count}</span>
        </Button>
      {/each}
    </div>
  </div>

  <!-- Missing deps banner -->
  {#if skillsWithMissing.length > 0}
    <div class="mb-3 rounded-md border border-warning/20 bg-warning/5 px-3 py-2">
      <Button variant="ghost"
        type="button"
        class="w-full text-left flex items-center gap-2 bg-transparent border-none cursor-pointer p-0"
        onclick={() => (missingBannerExpanded = !missingBannerExpanded)}
      >
        <span class="text-[length:var(--font-size-telemetry)] text-warning">
          {m.skills_unmetDeps({ count: skillsWithMissing.length })}
        </span>
        <span class="text-[length:var(--font-size-telemetry)] text-warning/60 ml-auto">
          {missingBannerExpanded ? '▾' : '▸'}
        </span>
      </Button>
      {#if missingBannerExpanded}
        <div class="mt-2 space-y-1">
          {#each skillsWithMissing as skill (skill.skillKey)}
            <div class="text-[length:var(--font-size-telemetry)] text-muted-foreground flex items-center gap-1.5">
              <span class="text-foreground/70">{skill.name}:</span>
              <span class="text-warning/70">
                {[...(skill.missing?.bins ?? []), ...(skill.missing?.env ?? [])].join(', ')}
              </span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  {#if agentSkillsState.loading && agentSkillsState.skills.length === 0}
    <div class="flex items-center justify-center py-8">
      <div class="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin"></div>
      <span class="ml-2 text-[length:var(--font-size-caption)] text-muted-foreground">{m.skills_loading()}</span>
    </div>
  {:else if agentSkillsState.error}
    <div class="bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-2 text-[length:var(--font-size-caption)] text-destructive">
      {agentSkillsState.error}
    </div>
  {:else if agentSkillsState.skills.length === 0}
    <div class="text-[length:var(--font-size-caption)] text-muted-foreground py-4">{m.skills_noSkills()}</div>
  {:else}
    <!-- Skills toggle list -->
    <div class="flex-1 overflow-y-auto -mx-1">
      {#each visibleSkills as skill (skill.skillKey)}
        {@const isEnabled = skill.agentEnabled && !skill.disabled}
        {@const hasMissing = (skill.missing?.bins?.length ?? 0) > 0 || (skill.missing?.env?.length ?? 0) > 0}
        <div
          class="flex items-center gap-2.5 px-3 py-1.5 rounded-md transition-colors group
            hover:bg-[var(--color-text-primary)]/[0.03]"
          title={skill.description ?? ''}
        >
          <!-- Toggle -->
          <div class="shrink-0">
            {#if skill.always}
              <ToggleSwitch checked={true} id="skill-{skill.skillKey}" />
            {:else}
              <ToggleSwitch
                checked={isEnabled}
                id="skill-{skill.skillKey}"
                onchange={(checked) => toggleSkill(skill, checked)}
              />
            {/if}
          </div>

          <!-- Emoji -->
          {#if skill.emoji}
            <span class="text-sm shrink-0">{skill.emoji}</span>
          {/if}

          <!-- Name + badges -->
          <div class="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
            <span
              class="text-[length:var(--font-size-caption)] font-medium truncate
                {isEnabled ? 'text-foreground' : 'text-muted-foreground'}"
            >
              {skill.name}
            </span>
            {#if skill.bundled}
              <span class="shrink-0 bg-accent/15 border border-accent/25 rounded-full px-1.5 text-[length:var(--font-size-telemetry)] text-accent leading-relaxed">
                {m.skills_badgeBundled()}
              </span>
            {/if}
            {#if skill.always}
              <span class="shrink-0 bg-[var(--color-warning-surface)] border border-[var(--color-warning-border)] rounded-full px-1.5 text-[length:var(--font-size-telemetry)] text-[var(--color-warning-fg)] leading-relaxed">
                {m.skills_badgeAlways()}
              </span>
            {/if}
            {#if hasMissing}
              <span
                class="shrink-0 text-[length:var(--font-size-telemetry)] text-warning/70"
                title="Missing: {[...(skill.missing?.bins ?? []), ...(skill.missing?.env ?? [])].join(', ')}"
              >!</span>
            {/if}
          </div>
        </div>
      {/each}

      {#if visibleSkills.length === 0 && searchQuery.trim()}
        <div class="text-[length:var(--font-size-caption)] text-muted-strong text-center py-6">
          {m.skills_noMatching({ query: searchQuery })}
        </div>
      {/if}
    </div>
  {/if}
</div>
