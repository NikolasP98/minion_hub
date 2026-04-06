<script lang="ts">
  import {
    Blocks,
    User,
    Brain,
    Wrench,
    Shield,
    Activity,
    Settings,
    Sliders,
    Database,
    Layers,
    Link,
    Search,
  } from 'lucide-svelte';
  import type { ResolvedGroup, ResolvedField } from '$lib/utils/agent-settings-schema';
  import * as m from '$lib/paraglide/messages';

  const GROUP_ICONS: Record<string, typeof User> = {
    identity: User,
    model: Brain,
    workspace: Database,
    'memory-search': Search,
    'context-pruning': Layers,
    compaction: Layers,
    behavior: Activity,
    'tool-profile': Wrench,
    sandbox: Shield,
    session: Sliders,
    advanced: Settings,
  };

  let {
    activeSection,
    onselect,
    groups,
    enabledSkillCount = 0,
    totalSkillCount = 0,
    bindingCount = 0,
    searchQuery = $bindable(''),
  }: {
    activeSection: string;
    onselect: (id: string) => void;
    groups: ResolvedGroup[];
    enabledSkillCount?: number;
    totalSkillCount?: number;
    bindingCount?: number;
    searchQuery?: string;
  } = $props();

  function countOverrides(fields: ResolvedField[]): number {
    return fields.filter((f) => f.isOverridden).length;
  }

  /** Critical groups always shown at full opacity */
  const CRITICAL_GROUPS = new Set(['identity', 'model']);

  const filteredGroups = $derived.by(() => {
    if (!searchQuery.trim()) return groups;
    const q = searchQuery.toLowerCase();
    return groups.filter((g) => {
      if (g.group.label.toLowerCase().includes(q)) return true;
      return g.fields.some(
        (f) =>
          (f.hint?.label ?? f.key).toLowerCase().includes(q) ||
          (f.hint?.help ?? '').toLowerCase().includes(q),
      );
    });
  });
</script>

<nav class="w-[200px] shrink-0 border-r border-border overflow-y-auto bg-bg2/50 flex flex-col">
  <!-- Search -->
  <div class="px-3 pt-3 pb-2">
    <div class="relative">
      <Search
        size={13}
        class="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/50 pointer-events-none"
      />
      <input
        type="text"
        bind:value={searchQuery}
        placeholder="Search settings…"
        class="w-full bg-bg3 border border-border rounded-md text-[11px] text-foreground
          pl-7 pr-2 py-1.5 outline-none placeholder:text-muted-foreground/40
          focus:border-accent/50 transition-colors"
      />
    </div>
  </div>

  <!-- Skills nav item -->
  <div class="px-2 pb-1">
    <button
      type="button"
      class="w-full text-left px-2.5 py-[7px] rounded-md text-xs transition-colors flex items-center gap-2.5 cursor-pointer border-none
        {activeSection === 'skills'
          ? 'bg-accent/10 text-accent font-medium border-l-2 border-l-accent -ml-px'
          : 'bg-transparent text-muted-foreground hover:bg-bg3 hover:text-foreground'}"
      onclick={() => onselect('skills')}
    >
      <Blocks size={14} class="shrink-0" />
      <span class="flex-1 truncate">{m.skills_title()}</span>
      {#if totalSkillCount > 0}
        <span class="text-[9px] text-muted-foreground/60">{enabledSkillCount}/{totalSkillCount}</span>
      {/if}
    </button>
  </div>

  <!-- Divider -->
  <div class="mx-3 border-t border-border/50 my-1"></div>

  <!-- Settings groups -->
  <div class="px-2 py-1 flex-1 space-y-px">
    <div class="px-2.5 pt-1 pb-1.5 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/40 select-none">
      Settings
    </div>
    {#each filteredGroups as { group, fields } (group.id)}
      {@const overrides = countOverrides(fields)}
      {@const isCritical = CRITICAL_GROUPS.has(group.id)}
      {@const Icon = GROUP_ICONS[group.id] ?? Settings}
      <button
        type="button"
        class="w-full text-left px-2.5 py-[7px] rounded-md text-xs transition-colors flex items-center gap-2.5 cursor-pointer border-none
          {activeSection === group.id
            ? 'bg-accent/10 text-accent font-medium border-l-2 border-l-accent -ml-px'
            : isCritical
              ? 'bg-transparent text-muted-foreground hover:bg-bg3 hover:text-foreground'
              : 'bg-transparent text-muted-foreground/60 hover:bg-bg3 hover:text-muted-foreground'}"
        onclick={() => onselect(group.id)}
      >
        <Icon size={14} class="shrink-0" />
        <span class="flex-1 truncate">{group.label}</span>
        {#if overrides > 0}
          <span class="text-[9px] text-accent font-medium">{overrides}</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- Bindings nav item -->
  {#if bindingCount > 0}
    <div class="px-2 pb-2">
      <div class="mx-1 border-t border-border/50 mb-1.5"></div>
      <button
        type="button"
        class="w-full text-left px-2.5 py-[7px] rounded-md text-xs transition-colors flex items-center gap-2.5 cursor-pointer border-none
          {activeSection === 'bindings'
            ? 'bg-accent/10 text-accent font-medium border-l-2 border-l-accent -ml-px'
            : 'bg-transparent text-muted-foreground hover:bg-bg3 hover:text-foreground'}"
        onclick={() => onselect('bindings')}
      >
        <Link size={14} class="shrink-0" />
        <span class="flex-1 truncate">{m.config_bindingsSection()}</span>
        <span class="text-[9px] text-muted-foreground/60">{bindingCount}</span>
      </button>
    </div>
  {/if}
</nav>
