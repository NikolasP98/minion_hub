<script lang="ts">
  import { groups, configState, dirtyPaths } from '$lib/state/config/config.svelte';
  import { hasConfiguredValues, META_GROUPS, getMetaGroupId } from '$lib/utils/config-schema';
  import type { CollapseLevel } from '$lib/components/Splitter.svelte';
  import {
    SlidersHorizontal,
    Brain,
    Zap,
    Radio,
    Plug,
    Monitor,
    MoreHorizontal,
  } from 'lucide-svelte';

  const META_ICONS: Record<string, any> = {
    setup:      SlidersHorizontal,
    ai:         Brain,
    automation: Zap,
    comms:      Radio,
    extensions: Plug,
    system:     Monitor,
    other:      MoreHorizontal,
  };

  let {
    activeGroupId,
    onselect,
    collapseLevel = 'expanded' as CollapseLevel,
  }: {
    activeGroupId: string | null;
    onselect: (id: string) => void;
    collapseLevel?: CollapseLevel;
  } = $props();

  const mini = $derived(collapseLevel !== 'expanded');

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

  // Build meta-group sections by order-range assignment; only include
  // meta-groups that have at least one group in the loaded config.
  const visibleMeta = $derived.by(() => {
    const byMeta = new Map<string, typeof groups.value>();
    for (const g of groups.value) {
      const metaId = getMetaGroupId(g.order);
      if (!byMeta.has(metaId)) byMeta.set(metaId, []);
      byMeta.get(metaId)!.push(g);
    }
    // Return in META_GROUPS order, only populated ones
    return META_GROUPS
      .filter((m) => byMeta.has(m.id))
      .map((m) => ({ ...m, items: byMeta.get(m.id)! }));
  });
</script>

<nav class="w-full shrink-0 border-r border-border overflow-y-auto py-3 bg-bg2/50">
  {#if mini}
    <div class="flex flex-col items-center gap-1 px-1 pt-1">
      {#each visibleMeta as meta (meta.id)}
        {@const Icon = META_ICONS[meta.id] ?? SlidersHorizontal}
        {@const firstGroup = meta.items[0]}
        <button
          type="button"
          class="w-8 h-8 flex items-center justify-center rounded-md transition-colors cursor-pointer border-none bg-transparent
            {meta.items.some(g => g.id === activeGroupId)
            ? 'text-accent bg-accent/10'
            : 'text-muted-foreground hover:text-foreground hover:bg-bg3'}"
          onclick={() => firstGroup && onselect(firstGroup.id)}
          title={meta.label}
          aria-label={meta.label}
        >
          <Icon size={15} />
        </button>
      {/each}
    </div>
  {:else}
    {#each visibleMeta as meta (meta.id)}
      <div class="px-3 pt-3 pb-1 text-[9.5px] font-semibold uppercase tracking-widest text-muted-foreground/50 select-none">
        {meta.label}
      </div>
      {#each meta.items as group (group.id)}
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
  {/if}
</nav>
