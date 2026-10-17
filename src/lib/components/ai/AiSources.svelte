<script lang="ts">
  /**
   * The pages behind an answer (SmoothUI `ai-sources`, MIT). Collapsed to a
   * stack of overlapping site marks — provenance available, not loud; hovering
   * fans the stack to hint it is a set; opening lists every page.
   *
   * Marks are a neutral globe on purpose: fetching each cited host's favicon
   * would leak the viewer's address to every site the model read.
   */
  import { slide } from 'svelte/transition';
  import { prefersReducedMotion } from 'svelte/motion';
  import { ChevronRight, Globe } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import type { AISource } from './sources';

  const STACK_LIMIT = 3;

  const { sources, label }: { sources: AISource[]; label?: string } = $props();

  let open = $state(false);
  const stacked = $derived(sources.slice(0, STACK_LIMIT));
  const overflow = $derived(sources.length - stacked.length);
  const dur = $derived(prefersReducedMotion.current ? 0 : 250);
</script>

{#if sources.length > 0}
  <div class="ai-sources" class:open>
    <Button
      variant="ghost"
      size="xs"
      class="ai-sources-head"
      aria-expanded={open}
      onclick={() => (open = !open)}
    >
      <span class="stack" aria-hidden="true">
        {#each stacked as s, i (s.url)}
          <span class="mark" style:z-index={stacked.length - i}>
            <Globe size={iconSizes.xs} />
          </span>
        {/each}
      </span>
      {#if overflow > 0}<span class="more">+{overflow}</span>{/if}
      <span>{label ?? m.ai_sources()}</span>
      <ChevronRight size={iconSizes.xs} class="chev" aria-hidden="true" />
    </Button>
    {#if open}
      <ul class="list" transition:slide={{ duration: dur }}>
        {#each sources as s (s.url)}
          <li>
            <a href={s.url} target="_blank" rel="noopener noreferrer" class="row">
              <span class="mark solo" aria-hidden="true"><Globe size={iconSizes.xs} /></span>
              <span class="txt">
                <span class="title">{s.title}</span>
                <span class="sub">{s.snippet ?? s.host}</span>
              </span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/if}

<style>
  .ai-sources {
    max-width: 100%;
    min-width: 0;
  }
  .ai-sources :global(.ai-sources-head) {
    height: auto;
    min-height: var(--control-height-xs);
    padding: var(--space-0-5) var(--space-1);
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
  }
  .ai-sources :global(.ai-sources-head > span) {
    gap: var(--space-2);
  }
  .ai-sources :global(.ai-sources-head:hover) {
    color: var(--color-text-primary);
  }
  .stack {
    display: inline-flex;
    align-items: center;
  }
  .mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--space-4);
    height: var(--space-4);
    flex-shrink: 0;
    border-radius: var(--radius-full);
    border: 1px solid var(--color-border);
    background: var(--color-surface-1);
    color: var(--color-text-tertiary);
    position: relative;
    transition: margin-left var(--duration-normal) var(--ease-spring);
  }
  .stack .mark + .mark {
    margin-left: calc(var(--space-2) * -1);
  }
  /* Fan apart on hover/focus while closed: a set, not a single badge. */
  .ai-sources:not(.open):hover .stack .mark + .mark,
  .ai-sources:not(.open):focus-within .stack .mark + .mark {
    margin-left: var(--space-0-5);
  }
  .more {
    font-variant-numeric: tabular-nums;
  }
  .ai-sources :global(.chev) {
    transition: transform var(--duration-normal) var(--ease-standard);
  }
  .ai-sources.open :global(.chev) {
    transform: rotate(90deg);
  }
  .list {
    list-style: none;
    margin: var(--space-1) 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-1);
    border-radius: var(--radius-md);
    text-decoration: none;
    transition: background-color var(--duration-fast) var(--ease-standard);
  }
  .row:hover {
    background: var(--color-surface-1);
  }
  .mark.solo {
    margin-top: var(--space-0-5);
  }
  .txt {
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .title,
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title {
    font-size: var(--font-size-label);
    font-weight: 500;
    color: var(--color-text-primary);
  }
  .sub {
    font-size: var(--font-size-caption);
    color: var(--color-text-tertiary);
  }
  @media (prefers-reduced-motion: reduce) {
    .mark {
      transition: none;
    }
  }
</style>
