<script lang="ts">
  /**
   * One chat message row (SmoothUI `ai-message`, MIT): content anchored to its
   * author's side, a timestamp pinned to that edge, and an action row that stays
   * out of the way until the message is hovered or focused.
   */
  import type { Snippet } from 'svelte';
  import MessageActions, {
    type MessageAction,
  } from '$lib/components/my-agent/MessageActions.svelte';

  interface Props {
    from?: 'user' | 'assistant';
    /** Preformatted time. */
    timestamp?: string;
    actions?: MessageAction[];
    class?: string;
    children: Snippet;
  }

  const {
    from = 'assistant',
    timestamp,
    actions = [],
    class: cls = '',
    children,
  }: Props = $props();
  const isUser = $derived(from === 'user');
</script>

<div class="ai-message {cls}" class:user={isUser}>
  {@render children()}
  {#if timestamp || actions.length > 0}
    <div class="foot">
      {#if timestamp}<span class="ts">{timestamp}</span>{/if}
      {#if actions.length > 0}
        <MessageActions {actions} reveal side={isUser ? 'end' : 'start'} />
      {/if}
    </div>
  {/if}
</div>

<style>
  .ai-message {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-0-5);
    max-width: 85%;
    min-width: 0;
    align-self: flex-start;
  }
  .ai-message.user {
    align-items: flex-end;
    align-self: flex-end;
  }
  /* Timestamp first so it stays pinned to the edge the bubble is anchored to. */
  .foot {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0 var(--space-1);
  }
  .user .foot {
    flex-direction: row-reverse;
  }
  .ts {
    font-size: var(--font-size-telemetry);
    font-variant-numeric: tabular-nums;
    color: var(--color-text-tertiary);
  }
</style>
