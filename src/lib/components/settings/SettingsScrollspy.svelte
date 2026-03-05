<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { ConfigGroup } from '$lib/types/config';

  let { groups, dirtyGroupIds, scrollContainer }: {
    groups: ConfigGroup[];
    dirtyGroupIds: Set<string>;
    scrollContainer: HTMLElement | null;
  } = $props();

  let activeGroupId = $state<string | null>(null);
  let observer: IntersectionObserver | null = null;

  // Track visible groups and pick the topmost
  const visibleGroups = new Map<string, IntersectionObserverEntry>();

  function setupObserver() {
    cleanupObserver();
    if (!scrollContainer || groups.length === 0) return;

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const gid = (entry.target as HTMLElement).dataset.groupId;
          if (!gid) continue;
          if (entry.isIntersecting) {
            visibleGroups.set(gid, entry);
          } else {
            visibleGroups.delete(gid);
          }
        }
        // Pick the topmost visible group (smallest boundingClientRect.top)
        let topId: string | null = null;
        let topY = Infinity;
        for (const [gid, entry] of visibleGroups) {
          if (entry.boundingClientRect.top < topY) {
            topY = entry.boundingClientRect.top;
            topId = gid;
          }
        }
        if (topId) activeGroupId = topId;
      },
      {
        root: scrollContainer,
        rootMargin: '-10% 0px -80% 0px',
        threshold: 0,
      }
    );

    // Observe all group sections
    const elements = scrollContainer.querySelectorAll('[data-group-id]');
    for (const el of elements) {
      observer.observe(el);
    }
  }

  function cleanupObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    visibleGroups.clear();
  }

  // Re-setup observer when scrollContainer or groups change
  $effect(() => {
    // Access reactive deps
    const _container = scrollContainer;
    const _groups = groups;
    setupObserver();
    return () => cleanupObserver();
  });

  onDestroy(() => cleanupObserver());

  function scrollToGroup(groupId: string) {
    const el = document.getElementById(`group-${groupId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
</script>

{#if groups.length > 1}
  <nav class="scrollspy-container hidden lg:flex" aria-label="Section navigation">
    {#each groups as group (group.id)}
      {@const isActive = activeGroupId === group.id}
      {@const isDirty = dirtyGroupIds.has(group.id)}
      <button
        type="button"
        class="scrollspy-dot"
        class:active={isActive}
        class:dirty={isDirty}
        onclick={() => scrollToGroup(group.id)}
        aria-label={group.label}
        aria-current={isActive ? 'true' : undefined}
      >
        <span class="scrollspy-tooltip">{group.label}</span>
      </button>
    {/each}
  </nav>
{/if}

<style>
  .scrollspy-container {
    position: fixed;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    flex-direction: column;
    align-items: center;
    gap: 8px;
    z-index: 30;
    opacity: 0.5;
    transition: opacity 0.2s ease;
  }
  .scrollspy-container:hover {
    opacity: 1;
  }

  .scrollspy-dot {
    position: relative;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--muted-foreground);
    opacity: 0.3;
    border: none;
    padding: 0;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .scrollspy-dot:hover {
    opacity: 0.8;
    transform: scale(1.3);
  }
  .scrollspy-dot.active {
    width: 8px;
    height: 8px;
    background: var(--accent);
    opacity: 1;
  }
  .scrollspy-dot.dirty:not(.active) {
    box-shadow: 0 0 0 2px var(--accent);
    opacity: 0.5;
  }

  .scrollspy-tooltip {
    position: absolute;
    right: 16px;
    top: 50%;
    transform: translateY(-50%);
    white-space: nowrap;
    font-size: 10px;
    color: var(--foreground);
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 2px 6px;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease;
  }
  .scrollspy-dot:hover .scrollspy-tooltip {
    opacity: 1;
  }
</style>
