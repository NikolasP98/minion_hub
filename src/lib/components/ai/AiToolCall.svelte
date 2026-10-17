<script lang="ts">
  /**
   * One tool invocation (or a group of them), collapsed by default: arguments and
   * results are available, never in the reader's face. Reverse-engineered from
   * SmoothUI `ai-tool-call` (MIT).
   */
  import { untrack, type Snippet } from 'svelte';
  import { slide } from 'svelte/transition';
  import { prefersReducedMotion } from 'svelte/motion';
  import { ChevronRight } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import AiToolStatusRing from './AiToolStatusRing.svelte';
  import type { AIToolStatus } from './ai-state';

  interface Props {
    /** Tool name, or a group label ("3 tool uses"). */
    name: string;
    status?: AIToolStatus;
    /** Arguments, pre-formatted. */
    input?: string;
    /** What the tool returned. */
    result?: string;
    /** Short trailing note, e.g. an argument preview or the tools in a group. */
    summary?: string;
    /** Mono name (a real tool id) vs. plain label (a group). */
    mono?: boolean;
    /** Floating-panel density: ring + chevron only, name in the accessible label. */
    compact?: boolean;
    defaultOpen?: boolean;
    /** Extra inline chips after the name (permission provenance). */
    meta?: Snippet;
    /** Replaces the arguments/result body (a group's per-tool rows). */
    children?: Snippet;
  }

  const {
    name,
    status = 'pending',
    input,
    result,
    summary,
    mono = true,
    compact = false,
    defaultOpen = false,
    meta,
    children,
  }: Props = $props();

  // Seeded once; afterwards the reader owns it.
  let open = $state(untrack(() => defaultOpen));

  const hasDetail = $derived(
    !!children || !!input || result !== undefined || status === 'running' || status === 'pending',
  );
  const statusLabel = $derived(
    {
      idle: '',
      pending: m.ai_toolQueued(),
      running: m.ai_toolRunning(),
      success: m.ai_toolDone(),
      error: m.ai_toolFailed(),
    }[status],
  );
  const dur = $derived(prefersReducedMotion.current ? 0 : 250);
</script>

<div class="ai-tool" class:compact class:open data-status={status}>
  <Button
    variant="ghost"
    size="xs"
    class="ai-tool-head"
    aria-expanded={hasDetail ? open : undefined}
    aria-label={statusLabel ? `${name} — ${statusLabel}` : name}
    disabled={!hasDetail}
    onclick={() => (open = !open)}
  >
    <AiToolStatusRing {status} size={compact ? iconSizes.sm : iconSizes.md} />
    {#if !compact}
      <span class="name" class:mono>{name}</span>
      {#if meta}{@render meta()}{/if}
      {#if summary}<span class="summary">{summary}</span>{/if}
    {/if}
    {#if hasDetail}
      <ChevronRight size={iconSizes.xs} class="chev" aria-hidden="true" />
    {/if}
  </Button>
  {#if open && hasDetail}
    <div class="body" transition:slide={{ duration: dur }}>
      {#if children}
        {@render children()}
      {:else}
        {#if input}
          <div class="sect">{m.ai_toolArguments()}</div>
          <pre class="pre">{input}</pre>
        {/if}
        {#if result !== undefined}
          <div class="sect">{status === 'error' ? m.ai_toolError() : m.ai_toolResult()}</div>
          <pre class="pre" class:err={status === 'error'}>{result}</pre>
        {:else if statusLabel}
          <div class="pending">{statusLabel}…</div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .ai-tool {
    max-width: 100%;
    min-width: 0;
  }
  .ai-tool :global(.ai-tool-head) {
    height: auto;
    min-height: var(--control-height-xs);
    max-width: 100%;
    padding: var(--space-0-5) var(--space-2);
    color: var(--color-text-tertiary);
    font-size: var(--font-size-caption);
  }
  .ai-tool :global(.ai-tool-head > span) {
    justify-content: flex-start;
    min-width: 0;
    max-width: 100%;
    gap: var(--space-2);
  }
  .ai-tool :global(.ai-tool-head:hover) {
    color: var(--color-text-secondary);
  }
  .ai-tool :global(.ai-tool-head:disabled) {
    opacity: 1;
  }
  .ai-tool.compact :global(.ai-tool-head) {
    padding: var(--space-0-5) var(--space-1);
  }
  .name {
    flex-shrink: 0;
    max-width: 24ch;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .name.mono {
    font-family: var(--font-mono, ui-monospace, monospace);
  }
  .summary {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--color-text-tertiary);
  }
  .ai-tool :global(.chev) {
    flex-shrink: 0;
    transition: transform var(--duration-normal) var(--ease-standard);
  }
  .ai-tool.open > :global(.ai-tool-head) :global(.chev) {
    transform: rotate(90deg);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-2) var(--space-2) var(--space-6);
  }
  .sect {
    font-size: var(--font-size-telemetry);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-tertiary);
    margin-top: var(--space-0-5);
  }
  .pre {
    margin: 0;
    padding: var(--space-2);
    border-radius: var(--radius-md);
    background: var(--color-surface-1);
    border: 1px solid var(--color-border);
    font-size: var(--font-size-caption);
    line-height: 1.45;
    font-family: var(--font-mono, ui-monospace, monospace);
    color: var(--color-text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 220px;
    overflow: auto;
    scrollbar-width: thin;
  }
  .pre.err {
    color: var(--color-danger-fg);
  }
  .pending {
    font-size: var(--font-size-caption);
    color: var(--color-text-tertiary);
    font-style: italic;
  }
</style>
