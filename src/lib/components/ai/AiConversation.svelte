<script lang="ts">
  /**
   * Scroll container for a thread (SmoothUI `ai-conversation`, MIT). It follows
   * the bottom ONLY while the reader is already there: scrolling up during a
   * reply is an explicit act, and dragging them back down is how chat UIs become
   * unusable. Away from the bottom, a pill offers the trip back.
   */
  import type { Snippet } from 'svelte';
  import { fly } from 'svelte/transition';
  import { prefersReducedMotion } from 'svelte/motion';
  import { ArrowDown } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';

  interface Props {
    children: Snippet;
    /** Changes whenever content grows (message count, streamed length). */
    contentKey?: unknown;
    /** Classes for the outer box (sizing in the host layout). */
    class?: string;
    /** Classes for the scrolling viewport (padding, gaps). */
    viewportClass?: string;
    /** The viewport element, for hosts that need it. */
    viewport?: HTMLDivElement | null;
    /** Reports pinned/unpinned, for hosts that track it. */
    onpinnedchange?: (pinned: boolean) => void;
  }

  let {
    children,
    contentKey,
    class: cls = '',
    viewportClass = '',
    viewport = $bindable(null),
    onpinnedchange,
  }: Props = $props();

  /** Near enough to count as "at the bottom" without yanking a reader a few lines up. */
  const BOTTOM_THRESHOLD_PX = 48;

  let pinned = $state(true);
  let content = $state<HTMLDivElement | null>(null);

  function setPinned(v: boolean) {
    if (v === pinned) return;
    pinned = v;
    onpinnedchange?.(v);
  }

  function measure() {
    if (!viewport) return;
    setPinned(
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= BOTTOM_THRESHOLD_PX,
    );
  }

  /** Jump to the newest content and resume following. */
  export function scrollToBottom(smooth = false) {
    if (!viewport) return;
    const behavior: ScrollBehavior = smooth && !prefersReducedMotion.current ? 'smooth' : 'auto';
    if (typeof viewport.scrollTo === 'function')
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    else viewport.scrollTop = viewport.scrollHeight;
    setPinned(true);
  }

  // Runs after the DOM update, so the jump lands in the frame the content grew.
  $effect(() => {
    void contentKey;
    if (pinned) scrollToBottom();
  });

  // Growth that doesn't change contentKey — a tool row opening, an image loading.
  $effect(() => {
    if (!content || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (pinned) scrollToBottom();
    });
    ro.observe(content);
    return () => ro.disconnect();
  });
</script>

<div class="ai-conversation {cls}">
  <div class="viewport {viewportClass}" bind:this={viewport} onscroll={measure}>
    <div class="content" bind:this={content}>
      {@render children()}
    </div>
  </div>
  {#if !pinned}
    <div class="jump" transition:fly={{ y: 8, duration: prefersReducedMotion.current ? 0 : 200 }}>
      <Button variant="secondary" size="xs" class="ai-jump" onclick={() => scrollToBottom(true)}>
        <ArrowDown size={iconSizes.xs} aria-hidden="true" />
        {m.ai_jumpToLatest()}
      </Button>
    </div>
  {/if}
</div>

<style>
  .ai-conversation {
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .viewport {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--color-border) transparent;
  }
  .content {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }
  .jump {
    position: absolute;
    bottom: var(--space-3);
    left: 0;
    right: 0;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .jump :global(.ai-jump) {
    pointer-events: auto;
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-overlay);
  }
</style>
