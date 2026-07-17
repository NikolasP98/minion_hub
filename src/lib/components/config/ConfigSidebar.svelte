<script lang="ts">
  import { Button } from '$lib/components/ui';
  import { groups, configState, dirtyPaths } from '$lib/state/config/config.svelte';
  import { hasConfiguredValues, META_GROUPS, getMetaGroupId } from '$lib/utils/config-schema';
  import type { CollapseLevel } from '$lib/components/layout/Splitter.svelte';
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
        <Button
          variant={meta.items.some((group) => group.id === activeGroupId) ? 'primary' : 'ghost'}
          size="icon"
          type="button"
          onclick={() => firstGroup && onselect(firstGroup.id)}
          title={meta.label()}
          aria-label={meta.label()}
          aria-pressed={meta.items.some((group) => group.id === activeGroupId)}
        >
          <Icon size={15} />
        </Button>
      {/each}
    </div>
  {:else}
    {#each visibleMeta as meta (meta.id)}
      <div class="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-widest text-muted-strong select-none">
        {meta.label()}
      </div>
      {#each meta.items as group (group.id)}
        {@const dirtyCount = dirtyCountForGroup(group.id)}
        {@const configured = isGroupConfigured(group.id)}
        <Button
          variant={activeGroupId === group.id ? 'primary' : 'ghost'}
          size="sm"
          type="button"
          class="!w-full !justify-start my-px {configured || activeGroupId === group.id ? '' : 'opacity-70'}"
          onclick={() => onselect(group.id)}
          aria-current={activeGroupId === group.id ? 'true' : undefined}
        >
          <span class="flex-1 truncate">{group.label}</span>
          {#if dirtyCount > 0}
            <span class="w-1.5 h-1.5 rounded-full bg-accent shrink-0"></span>
          {/if}
        </Button>
      {/each}
    {/each}
  {/if}
</nav>
