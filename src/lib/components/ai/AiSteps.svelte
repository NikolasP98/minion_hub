<script module lang="ts">
  // The live turn and the committed turn are different instances: remember the
  // measured duration by turn key so the committed one can still say it.
  const measured = new Map<string, number>();
</script>

<script lang="ts">
  /**
   * Everything the assistant did before its answer — reasoning and tool calls —
   * folded into ONE quiet line (spec 025, "C2 · icon stack"): a stack of the
   * latest step icons, then Notion's header (spec 026): "Working for 3 s" with
   * the thinking spinner while the turn runs, "Worked for 15 s" after. The step
   * list opens by itself while the turn runs, so each step's verb is visible.
   */
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import { slide } from 'svelte/transition';
  import { prefersReducedMotion } from 'svelte/motion';
  import { Brain, ChevronRight } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import ThinkingShader from '$lib/components/assistant/ThinkingShader.svelte';
  import AiToolStatusRing from './AiToolStatusRing.svelte';
  import type { AIStep } from './ai-state';

  interface Props {
    steps: AIStep[];
    /** The turn is still producing steps (no answer text yet). */
    running?: boolean;
    /** Stable per-turn id, so the live and committed renders share the timer. */
    turnKey?: string;
    defaultOpen?: boolean;
    /** The per-step rows. */
    children: Snippet;
  }

  const { steps, running = false, turnKey, defaultOpen = false, children }: Props = $props();

  /** Icons shown before collapsing the rest into "+N". */
  const MAX_ICONS = 5;

  let open = $state(untrack(() => defaultOpen || running));

  // ── elapsed time: ticks while running, frozen (and remembered) after ──
  let startedAt: number | null = null;
  let now = $state(Date.now());
  let seconds = $state<number | null>(
    untrack(() => (turnKey ? (measured.get(turnKey) ?? null) : null)),
  );
  let timer: ReturnType<typeof setInterval> | undefined;
  $effect(() => {
    if (running) {
      untrack(() => {
        startedAt ??= Date.now() - (seconds ?? 0) * 1000;
        open = true;
      });
      timer = setInterval(() => (now = Date.now()), 1000);
      return () => clearInterval(timer);
    }
    if (startedAt !== null) {
      const s = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      startedAt = null;
      seconds = s;
      const key = untrack(() => turnKey);
      if (key) measured.set(key, s);
      if (measured.size > 200) measured.delete(measured.keys().next().value as string);
    }
  });
  onDestroy(() => clearInterval(timer));
  const liveSeconds = $derived(
    startedAt === null ? 0 : Math.max(0, Math.round((now - startedAt) / 1000)),
  );

  const tools = $derived(steps.filter((s) => s.kind === 'tool'));
  const failed = $derived(tools.filter((s) => s.status === 'error').length);
  const allFailed = $derived(!running && tools.length > 0 && failed === tools.length);
  const shown = $derived(steps.slice(-MAX_ICONS));
  const hidden = $derived(steps.length - shown.length);
  const summary = $derived(
    running
      ? m.ai_workingFor({ seconds: String(liveSeconds) })
      : [
          seconds !== null
            ? m.ai_workedFor({ seconds: String(seconds) })
            : m.ai_steps({ count: steps.length }),
          ...(tools.length ? [m.ai_toolUses({ count: tools.length })] : []),
          ...(failed ? [m.ai_stepsFailed({ count: failed })] : []),
        ].join(' · '),
  );
  const dur = $derived(prefersReducedMotion.current ? 0 : 250);
</script>

<div class="ai-steps" class:open>
  <Button
    variant="ghost"
    size="xs"
    class="ai-steps-head"
    aria-expanded={open}
    aria-label={summary}
    title={summary}
    onclick={() => (open = !open)}
  >
    <ChevronRight size={iconSizes.xs} class="chev" aria-hidden="true" />
    <span class="stack" aria-hidden="true">
      {#if hidden > 0}<i class="count">+{hidden}</i>{/if}
      {#each shown as step, i (i)}
        <i class:bad={step.status === 'error'}>
          {#if step.kind === 'tool'}
            <AiToolStatusRing status={step.status} size={iconSizes.sm} />
          {:else}
            <Brain size={iconSizes.xs} />
          {/if}
        </i>
      {/each}
    </span>
    {#if running}<ThinkingShader size={iconSizes.md} />{/if}
    <span class="label" class:shimmer={running} class:bad={allFailed}>{summary}</span>
  </Button>
  {#if open}
    <div class="body" transition:slide={{ duration: dur }}>
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .ai-steps {
    width: 100%;
    min-width: 0;
  }
  .ai-steps :global(.ai-steps-head) {
    height: auto;
    min-height: var(--control-height-xs);
    max-width: 100%;
    padding: var(--space-0-5) var(--space-2);
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
  }
  /* Button's inner row: icons keep their size, the label shrinks to an ellipsis. */
  .ai-steps :global(.ai-steps-head > span) {
    justify-content: flex-start;
    min-width: 0;
    max-width: 100%;
    gap: var(--space-2);
    overflow: hidden;
  }
  .ai-steps :global(.ai-steps-head:hover) {
    color: var(--color-text-secondary);
  }
  .ai-steps :global(.chev) {
    flex-shrink: 0;
    transition: transform var(--duration-normal) var(--ease-standard);
  }
  .ai-steps.open :global(.chev) {
    transform: rotate(90deg);
  }
  .stack {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
  }
  .stack i {
    display: grid;
    place-items: center;
    /* 20px: smaller than a control, so the stack reads as a glyph row. */
    width: calc(var(--space-4) + var(--space-1));
    height: calc(var(--space-4) + var(--space-1));
    margin-left: calc(var(--space-2) * -1);
    border-radius: var(--radius-full);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    color: var(--color-text-secondary);
    font-style: normal;
    box-sizing: border-box;
  }
  .stack i:first-child {
    margin-left: 0;
  }
  .stack i.bad {
    border-color: var(--color-danger-border);
  }
  .stack i.count {
    width: auto;
    min-width: calc(var(--space-4) + var(--space-1));
    padding: 0 var(--space-1);
    font-size: var(--font-size-telemetry);
    font-variant-numeric: tabular-nums;
  }
  .label {
    min-width: 0;
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-secondary);
  }
  .label.bad {
    color: var(--color-danger-fg);
  }
  /* Same "still working" signal as AiReasoning, only while the turn runs. */
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
    -webkit-text-fill-color: transparent;
    animation: ai-steps-shimmer calc(var(--duration-slow) * 4.5) linear infinite;
  }
  @keyframes ai-steps-shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }
  /* Notion's rail: the steps hang off one thin line under the header. */
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-0-5);
    margin: var(--space-0-5) 0 var(--space-1) var(--space-3);
    padding-left: var(--space-2);
    border-left: 1px solid var(--color-border);
    min-width: 0;
  }
  @media (prefers-reduced-motion: reduce) {
    .shimmer {
      animation: none;
      background: none;
      -webkit-text-fill-color: currentColor;
    }
  }
</style>
