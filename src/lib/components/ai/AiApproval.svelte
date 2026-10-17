<script lang="ts">
  /**
   * The card an agent puts up before it acts (SmoothUI `ai-approval`, MIT).
   * Choosing does not tick a radio: the chosen option fills the card and the
   * alternatives collapse away, so the decision looks as settled as it is.
   */
  import { untrack, type Snippet } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { prefersReducedMotion } from 'svelte/motion';
  import { Check } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';

  export interface AIApprovalOption {
    id: string;
    label: string;
    /** Secondary line, right-aligned. */
    detail?: string;
    destructive?: boolean;
  }

  interface Props {
    /** What the agent needs a human to settle. Optional when the bubble already asks it. */
    question?: string;
    options: AIApprovalOption[];
    /** Called once, with the chosen option. Absent ⇒ read-only (no send path here). */
    onDecide?: (option: AIApprovalOption) => void;
    /** Render already resolved (replaying a transcript). */
    resolvedId?: string;
    /** Extra context under the question. */
    children?: Snippet;
  }

  const { question, options, onDecide, resolvedId, children }: Props = $props();

  let chosenId = $state<string | null>(untrack(() => resolvedId ?? null));
  const chosen = $derived(options.find((o) => o.id === chosenId) ?? null);
  const dur = $derived(prefersReducedMotion.current ? 0 : 200);

  function decide(o: AIApprovalOption) {
    if (chosenId || !onDecide) return;
    chosenId = o.id;
    onDecide(o);
  }
</script>

<div class="ai-approval" data-assist="assistant.choice">
  {#if question}<p class="q">{question}</p>{/if}
  {#if children}<div class="ctx">{@render children()}</div>{/if}
  <!-- Both states share one grid cell so the swap cross-fades in place. -->
  <div class="stage">
    {#if chosen}
      <div
        class="resolved"
        class:destructive={chosen.destructive}
        role="status"
        in:scale={{ start: 0.97, duration: dur }}
      >
        <Check size={iconSizes.sm} aria-hidden="true" />
        <span class="label">{chosen.label}</span>
        {#if chosen.detail}<span class="detail">{chosen.detail}</span>{/if}
      </div>
    {:else}
      <div class="opts" out:fade={{ duration: dur * 0.8 }}>
        {#each options as o (o.id)}
          <Button
            variant={o.destructive ? 'danger' : 'secondary'}
            size="sm"
            class="ai-approval-opt"
            disabled={!onDecide}
            onclick={() => decide(o)}
          >
            <span class="label">{o.label}</span>
            {#if o.detail}<span class="detail">{o.detail}</span>{/if}
          </Button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .ai-approval {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-top: var(--space-1);
    width: 100%;
    max-width: 32rem;
  }
  .q {
    margin: 0;
    font-size: var(--font-size-label);
    font-weight: 500;
    color: var(--color-text-primary);
  }
  .ctx {
    font-size: var(--font-size-caption);
    color: var(--color-text-secondary);
  }
  .stage {
    display: grid;
  }
  .stage > * {
    grid-area: 1 / 1;
  }
  .opts {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .opts :global(.ai-approval-opt) {
    width: 100%;
    justify-content: flex-start;
  }
  .opts :global(.ai-approval-opt > span) {
    width: 100%;
    justify-content: space-between;
  }
  .resolved {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control-height-sm);
    padding: 0 var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-accent);
    color: var(--color-on-accent);
    font-size: var(--font-size-label);
  }
  .resolved.destructive {
    background: var(--color-danger-surface);
    color: var(--color-danger-fg);
    border: 1px solid var(--color-danger-border);
  }
  .label {
    font-weight: 500;
  }
  .detail {
    margin-left: auto;
    font-size: var(--font-size-caption);
    opacity: 0.75;
  }
</style>
