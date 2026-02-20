<script lang="ts">
  import { groups, configState, dirtyPaths } from '$lib/state/config.svelte';
  import { hasConfiguredValues } from '$lib/utils/config-schema';

  let { activeGroupId, onselect }: { activeGroupId: string | null; onselect: (id: string) => void } = $props();

  function dirtyCountForGroup(groupId: string): number {
    let count = 0;
    const group = groups.value.find((g) => g.id === groupId);
    if (!group) return 0;
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
</script>

<nav class="w-[220px] shrink-0 border-r border-border overflow-y-auto py-4 px-3 bg-bg2/50">
  <div class="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-3 px-2">Sections</div>
  {#each groups.value as group (group.id)}
    {@const dirtyCount = dirtyCountForGroup(group.id)}
    {@const configured = isGroupConfigured(group.id)}
    <button
      type="button"
      class="w-full text-left px-2.5 py-[7px] rounded-md text-xs transition-colors flex items-center gap-2 cursor-pointer border-none
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
</nav>
