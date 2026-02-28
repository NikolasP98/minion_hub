<script lang="ts">
  import { groups, configState, dirtyPaths } from '$lib/state/config.svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { hasConfiguredValues } from '$lib/utils/config-schema';

  let { activeGroupId, onselect }: { activeGroupId: string | null; onselect: (id: string) => void } = $props();

  // ── Meta-group definitions ───────────────────────────────────────────────
  const META_GROUPS = [
    { id: 'setup',        label: 'Setup',          groupIds: ['wizard', 'update', 'gateway', 'nodeHost', 'diagnostics'] },
    { id: 'ai',           label: 'AI',             groupIds: ['models', 'agents', 'tools'] },
    { id: 'automation',   label: 'Automation',     groupIds: ['commands', 'cron', 'hooks', 'skills', 'plugins'] },
    { id: 'data',         label: 'Data',           groupIds: ['session', 'messages', 'bindings'] },
    { id: 'comms',        label: 'Communication',  groupIds: ['channels', 'audio', 'talk', 'voicewake'] },
    { id: 'integrations', label: 'Integrations',   groupIds: ['browser', 'discovery', 'presence'] },
    { id: 'system',       label: 'System',         groupIds: ['ui', 'logging'] },
  ];

  // ── Helpers ──────────────────────────────────────────────────────────────

  function dirtyCountForGroup(groupId: string): number {
    const group = groups.value.find((g) => g.id === groupId);
    if (!group) return 0;
    let count = 0;
    for (const field of group.fields) {
      if (dirtyPaths.value.has(field.key)) count++;
    }
    return count;
  }

  function isGroupConfigured(groupId: string): boolean {
    const group = groups.value.find((g) => g.id === groupId);
    if (!group) return false;
    const val = configState.current[group.fields[0]?.key];
    return hasConfiguredValues(val);
  }

  // Build an ordered list of [metaGroup, ConfigGroup[]] pairs, only including
  // meta-groups that have at least one group present in the loaded config.
  const visibleMeta = $derived.by(() => {
    const groupIds = new SvelteSet(groups.value.map((g) => g.id));
    const mapped = new SvelteSet<string>();
    const result: { id: string; label: string; groupIds: string[] }[] = [];

    for (const meta of META_GROUPS) {
      const present = meta.groupIds.filter((id) => groupIds.has(id));
      if (present.length > 0) {
        result.push({ ...meta, groupIds: present });
        for (const id of present) mapped.add(id);
      }
    }

    // Catch any groups not in any meta-group
    const unmapped = groups.value.filter((g) => !mapped.has(g.id));
    if (unmapped.length > 0) {
      result.push({ id: '_other', label: 'Other', groupIds: unmapped.map((g) => g.id) });
    }

    return result;
  });

  // Preserve insertion order of each meta-group's groups from the loaded list
  function metaGroupItems(metaGroupIds: string[]) {
    return metaGroupIds
      .map((id) => groups.value.find((g) => g.id === id))
      .filter((g) => g !== undefined);
  }
</script>

<nav class="w-[200px] shrink-0 border-r border-border overflow-y-auto py-3 bg-bg2/50">
  {#each visibleMeta as meta (meta.id)}
    <!-- Meta-group header -->
    <div class="px-3 pt-3 pb-1 text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground/50 select-none">
      {meta.label}
    </div>

    <!-- Groups in this meta-group -->
    {#each metaGroupItems(meta.groupIds) as group (group.id)}
      {@const dirtyCount = dirtyCountForGroup(group.id)}
      {@const configured = isGroupConfigured(group.id)}
      <button
        type="button"
        class="w-full text-left pl-4 pr-2.5 py-[6px] rounded-md text-xs transition-colors flex items-center gap-2 cursor-pointer border-none mx-1 my-px
          {activeGroupId === group.id
            ? 'bg-accent/10 text-accent font-medium'
            : configured
              ? 'bg-transparent text-muted-foreground hover:bg-bg3 hover:text-foreground'
              : 'bg-transparent text-muted-foreground/40 hover:bg-bg3 hover:text-muted-foreground'}"
        onclick={() => onselect(group.id)}
      >
        <span class="flex-1 truncate">{group.label}</span>
        {#if dirtyCount > 0}
          <span class="w-1.5 h-1.5 rounded-full bg-accent shrink-0"></span>
        {/if}
      </button>
    {/each}
  {/each}
</nav>
