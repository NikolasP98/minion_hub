<script lang="ts">
  import { Button } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
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
  <nav class="scrollspy-container hidden lg:flex" aria-label={m.a11y4_sectionNavigation()}>
    {#each groups as group (group.id)}
      {@const isActive = activeGroupId === group.id}
      {@const isDirty = dirtyGroupIds.has(group.id)}
      <Button variant="ghost" size="icon"
        type="button"
        class="scrollspy-trigger"
        onclick={() => scrollToGroup(group.id)}
        aria-label={group.label}
        aria-current={isActive ? 'true' : undefined}
      >
        <span class="scrollspy-dot" class:active={isActive} class:dirty={isDirty}></span>
        <span class="scrollspy-tooltip">{group.label}</span>
      </Button>
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
    gap: var(--space-2, 8px);
    z-index: var(--layer-sticky, 30);
    opacity: 0.5;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }
  .scrollspy-container:hover {
    opacity: 1;
  }

  :global(.scrollspy-trigger) {
    position: relative;
  }
  .scrollspy-dot {
    display: block;
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full, 999px);
    background: var(--muted-foreground);
    opacity: 0.3;
    transition: all var(--duration-fast) var(--ease-standard);
  }
  :global(.scrollspy-trigger:hover) .scrollspy-dot {
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
    box-shadow: var(--shadow-focus, 0 0 0 2px var(--accent));
    opacity: 0.5;
  }

  .scrollspy-tooltip {
    position: absolute;
    right: 16px;
    top: 50%;
    transform: translateY(-50%);
    white-space: nowrap;
    font-size: var(--font-size-caption, 10px);
    color: var(--foreground);
    background: var(--bg2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 4px);
    padding: var(--space-0-5, 2px) var(--space-2, 8px);
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }
  :global(.scrollspy-trigger:hover) .scrollspy-tooltip {
    opacity: 1;
  }
</style>
