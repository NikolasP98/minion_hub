<script lang="ts">
  /**
   * The prompt composer (SmoothUI `ai-prompt-input`, MIT). Grows with the draft
   * up to MAX_ROWS then scrolls; Enter sends, Shift+Enter breaks the line; the
   * send control becomes Stop while a reply runs; a counter appears near the limit.
   */
  import { tick, type Snippet } from 'svelte';
  import { scale } from 'svelte/transition';
  import { prefersReducedMotion } from 'svelte/motion';
  import { ArrowUp, Paperclip, Square, X } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { formatBytes } from '$lib/utils/format';
  import type { AIState } from './ai-state';

  export interface AIPromptAttachment {
    id: string;
    name: string;
    /** Bytes. */
    size?: number;
  }

  interface Props {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    /** `streaming`/`thinking` turn submit into Stop; `error` rings the box. */
    status?: AIState;
    /** Shows a counter from 80 % of the limit; past it the counter turns danger. */
    maxLength?: number;
    attachments?: AIPromptAttachment[];
    onsubmit?: (text: string) => void;
    onstop?: () => void;
    onattach?: () => void;
    onremoveattachment?: (id: string) => void;
    /** Runs first; call `preventDefault()` to claim the key (history, mentions). */
    onkeydown?: (e: KeyboardEvent) => void;
    /** Allow sending with an empty draft (e.g. attachments only). */
    allowEmpty?: boolean;
    'aria-label'?: string;
    /** Smaller paddings for the floating panel. */
    compact?: boolean;
    textarea?: HTMLTextAreaElement | null;
    /** Extra controls on the left of the toolbar (mode pickers). */
    children?: Snippet;
  }

  let {
    value = $bindable(''),
    placeholder,
    disabled = false,
    status = 'idle',
    maxLength,
    attachments = [],
    onsubmit,
    onstop,
    onattach,
    onremoveattachment,
    onkeydown,
    allowEmpty = false,
    'aria-label': ariaLabel,
    compact = false,
    textarea = $bindable(null),
    children,
  }: Props = $props();

  const MAX_ROWS = 8;
  const COUNTER_RATIO = 0.8;

  let focused = $state(false);
  const running = $derived(status === 'streaming' || status === 'thinking');
  const canSubmit = $derived(!disabled && (allowEmpty || value.trim().length > 0));
  const counterVisible = $derived(
    maxLength !== undefined && value.length >= maxLength * COUNTER_RATIO,
  );
  const overLimit = $derived(maxLength !== undefined && value.length > maxLength);
  const dur = $derived(prefersReducedMotion.current ? 0 : 180);

  function resize() {
    if (!textarea) return;
    // Collapse first, otherwise scrollHeight only ever grows.
    textarea.style.height = 'auto';
    const line = Number.parseFloat(getComputedStyle(textarea).lineHeight) || 20;
    const max = line * MAX_ROWS;
    textarea.style.height = `${Math.min(textarea.scrollHeight, max)}px`;
    textarea.style.overflowY = textarea.scrollHeight > max ? 'auto' : 'hidden';
  }

  $effect(() => {
    void value;
    resize();
  });

  function submit() {
    if (running) {
      onstop?.();
      return;
    }
    if (!canSubmit) return;
    onsubmit?.(value.trim());
    void tick().then(resize);
  }

  function keydown(e: KeyboardEvent) {
    onkeydown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  }
</script>

<div class="ai-prompt" class:focused class:compact class:disabled class:error={status === 'error'}>
  {#if attachments.length > 0}
    <ul class="atts">
      {#each attachments as a (a.id)}
        <li class="att" transition:scale={{ start: 0.9, duration: dur }}>
          <span class="att-name">{a.name}</span>
          {#if a.size !== undefined}<span class="att-size">{formatBytes(a.size)}</span>{/if}
          {#if onremoveattachment}
            <Button
              variant="ghost"
              shape="icon"
              size="xs"
              aria-label={m.ai_removeAttachment({ name: a.name })}
              onclick={() => onremoveattachment(a.id)}
            >
              <X size={iconSizes.xs} />
            </Button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}

  <textarea
    bind:this={textarea}
    bind:value
    rows="1"
    {placeholder}
    {disabled}
    aria-label={ariaLabel ?? placeholder}
    onfocus={() => (focused = true)}
    onblur={() => (focused = false)}
    onkeydown={keydown}></textarea>

  <div class="bar">
    <div class="left">
      {#if onattach}
        <Button
          variant="ghost"
          shape="icon"
          size="xs"
          aria-label={m.ai_attach()}
          {disabled}
          onclick={onattach}
        >
          <Paperclip size={iconSizes.sm} />
        </Button>
      {/if}
      {#if children}{@render children()}{/if}
    </div>
    <div class="right">
      {#if counterVisible}
        <span
          class="counter"
          class:over={overLimit}
          transition:scale={{ start: 0.9, duration: dur }}
        >
          {value.length}/{maxLength}
        </span>
      {/if}
      <Button
        variant="primary"
        shape="icon"
        size={compact ? 'xs' : 'sm'}
        class="ai-submit"
        aria-label={running ? m.ai_stop() : m.ai_send()}
        disabled={running ? !onstop : !canSubmit}
        onclick={submit}
      >
        <!-- Real glyphs swapped with a scale-fade, stacked so it reads as one control. -->
        <span class="glyph">
          {#key running}
            <span class="g" transition:scale={{ start: 0.6, duration: dur }}>
              {#if running}
                <Square size={iconSizes.xs} fill="currentColor" strokeWidth={0} />
              {:else}
                <ArrowUp size={compact ? iconSizes.sm : iconSizes.md} />
              {/if}
            </span>
          {/key}
        </span>
      </Button>
    </div>
  </div>
</div>

<style>
  .ai-prompt {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-xl);
    background: var(--color-surface-1);
    transition: border-color var(--duration-fast) var(--ease-standard);
  }
  .ai-prompt.focused {
    border-color: var(--color-border-strong);
  }
  /* Status shows only as a ring: a composer that changes shape fights the text. */
  .ai-prompt.error {
    border-color: var(--color-danger-border);
  }
  .ai-prompt.disabled {
    opacity: 0.6;
  }
  .ai-prompt.compact {
    border-radius: var(--radius-lg);
  }
  textarea {
    width: 100%;
    resize: none;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--color-text-primary);
    font: inherit;
    font-size: var(--font-size-body);
    line-height: 1.5;
    padding: var(--space-3) var(--space-4) var(--space-1);
  }
  .compact textarea {
    font-size: var(--font-size-label);
    padding: var(--space-2) var(--space-3) var(--space-1);
  }
  textarea::placeholder {
    color: var(--color-text-tertiary);
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: 0 var(--space-2) var(--space-2);
  }
  .left,
  .right {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
  }
  .right {
    gap: var(--space-2);
    flex-shrink: 0;
  }
  .counter {
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-tertiary);
  }
  .counter.over {
    color: var(--color-danger-fg);
  }
  .ai-prompt :global(.ai-submit) {
    border-radius: var(--radius-lg);
  }
  .glyph {
    display: grid;
    place-items: center;
  }
  .g {
    grid-area: 1 / 1;
    display: inline-flex;
  }
  .atts {
    list-style: none;
    margin: 0;
    padding: var(--space-2) var(--space-3) 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .att {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-0-5) var(--space-0-5) var(--space-0-5) var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface-2);
    font-size: var(--font-size-caption);
  }
  .att-name {
    max-width: 10rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .att-size {
    color: var(--color-text-tertiary);
  }
</style>
