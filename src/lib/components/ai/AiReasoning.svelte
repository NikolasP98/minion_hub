<script module lang="ts">
  // The live turn and the committed turn are different instances; remember the
  // measured duration by trace text so the committed one can still say it.
  const measured = new Map<string, number>();
  const keyOf = (text: string) => text.slice(0, 160);
</script>

<script lang="ts">
  /**
   * Collapsible reasoning trace (SmoothUI `ai-reasoning`, MIT). The summary
   * shimmers only while the model is actually thinking; afterwards it reports
   * how long it took and gets out of the way — unless the reader took control.
   */
  import { untrack } from 'svelte';
  import { slide } from 'svelte/transition';
  import { prefersReducedMotion } from 'svelte/motion';
  import { ChevronRight } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { formatSeconds } from '$lib/utils/format';

  interface Props {
    text: string;
    /** True while the model is still producing this trace. */
    active?: boolean;
    /** Collapse once `active` goes false. */
    collapseWhenDone?: boolean;
    /** Seconds spent; omit to time it here. */
    duration?: number;
    compact?: boolean;
    /** Contextual verb while active ("Reviewing results"); defaults to "Thinking". */
    activeLabel?: string;
  }

  const {
    text,
    active = false,
    collapseWhenDone = true,
    duration,
    compact = false,
    activeLabel,
  }: Props = $props();

  /** A beat before collapsing, so the trace is not yanked away mid-read. */
  const AUTO_COLLAPSE_MS = 600;

  let open = $state(untrack(() => active));
  let userControlled = $state(false);
  let startedAt: number | null = null;
  let seconds = $state<number | null>(untrack(() => measured.get(keyOf(text)) ?? null));

  $effect(() => {
    if (active) {
      startedAt = Date.now();
      untrack(() => {
        seconds = null;
        if (!userControlled) open = true;
      });
      return;
    }
    if (startedAt !== null) {
      const s = (Date.now() - startedAt) / 1000;
      startedAt = null;
      seconds = s;
      const key = keyOf(untrack(() => text));
      measured.set(key, s);
      if (measured.size > 200) measured.delete(measured.keys().next().value as string);
    }
  });

  $effect(() => {
    if (active || !collapseWhenDone || userControlled) return;
    const t = setTimeout(() => (open = false), AUTO_COLLAPSE_MS);
    return () => clearTimeout(t);
  });

  const shown = $derived(duration ?? seconds);
  const summary = $derived(
    active
      ? (activeLabel ?? m.ai_thinking())
      : shown !== null
        ? m.ai_thoughtFor({ seconds: formatSeconds(shown) })
        : m.ai_reasoning(),
  );
  const dur = $derived(prefersReducedMotion.current ? 0 : 250);
</script>

<div class="ai-reasoning" class:open class:compact>
  <Button
    variant="ghost"
    size="xs"
    class="ai-reasoning-head"
    aria-expanded={open}
    aria-label={summary}
    onclick={() => {
      userControlled = true;
      open = !open;
    }}
  >
    <ChevronRight size={iconSizes.xs} class="chev" aria-hidden="true" />
    {#if !compact}
      <span class="label" class:shimmer={active}>{summary}</span>
    {/if}
  </Button>
  {#if open}
    <div class="trace" transition:slide={{ duration: dur }}>{text}</div>
  {/if}
</div>

<style>
  .ai-reasoning {
    max-width: 100%;
    min-width: 0;
  }
  .ai-reasoning :global(.ai-reasoning-head) {
    height: auto;
    min-height: var(--control-height-xs);
    padding: var(--space-0-5) var(--space-2);
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
  }
  .ai-reasoning :global(.ai-reasoning-head > span) {
    justify-content: flex-start;
    gap: var(--space-1);
  }
  .ai-reasoning :global(.ai-reasoning-head:hover) {
    color: var(--color-text-secondary);
  }
  .ai-reasoning.compact :global(.ai-reasoning-head) {
    padding: var(--space-0-5) var(--space-1);
  }
  .ai-reasoning :global(.chev) {
    flex-shrink: 0;
    transition: transform var(--duration-normal) var(--ease-standard);
  }
  .ai-reasoning.open :global(.chev) {
    transform: rotate(90deg);
  }
  /* The shimmer is the "still working" signal, so it exists only while active. */
  .shimmer {
    background-image: linear-gradient(
      90deg,
      currentColor 0%,
      currentColor 35%,
      color-mix(in oklab, currentColor 25%, transparent) 50%,
      currentColor 65%,
      currentColor 100%
    );
    background-size: 200% 100%;
    background-clip: text;
    -webkit-background-clip: text;
    /* Fill, not colour: the gradient's currentColor must stay the label colour. */
    -webkit-text-fill-color: transparent;
    animation: ai-reasoning-shimmer calc(var(--duration-slow) * 4.5) linear infinite;
  }
  @keyframes ai-reasoning-shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }
  /* The rule reads as a margin note: an aside, not part of the answer. */
  .trace {
    margin: var(--space-0-5) 0 var(--space-1) var(--space-3);
    padding-left: var(--space-3);
    border-left: 1px solid var(--color-border);
    font-size: var(--font-size-caption);
    line-height: 1.55;
    color: var(--color-text-tertiary);
    white-space: pre-wrap;
    font-style: italic;
  }
  @media (prefers-reduced-motion: reduce) {
    .shimmer {
      animation: none;
      background: none;
      -webkit-text-fill-color: currentColor;
    }
  }
</style>
