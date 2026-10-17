<script lang="ts">
  import { extractText, extractMessageTimestamp } from '$lib/utils/text';
  import AIDisclosureBadge from './AIDisclosureBadge.svelte';
  import ChatBlocks from '$lib/chat/ChatBlocks.svelte';
  import { isToolResultOnly, assistantHasContent } from '$lib/chat/blocks';
  import { useAliasDirectory, getAliases } from '$lib/state/features/aliases.svelte';
  import { renderMention } from '$lib/utils/mention';
  import { AiMessage } from '$lib/components/ai';
  import type { MessageAction } from '$lib/components/my-agent/MessageActions.svelte';
  import { Copy } from 'lucide-svelte';
  import * as msg from '$lib/paraglide/messages';

  let {
    message,
    streaming = false,
    error = false,
  }: {
    message: unknown;
    streaming?: boolean;
    error?: boolean;
  } = $props();

  const m = $derived(
    message as { role?: string; content?: unknown; provenance?: { disclosure?: string } },
  );
  const text = $derived(extractText(message) ?? '');
  const role = $derived(m.role === 'user' ? 'user' : 'assistant');
  const timestamp = $derived(extractMessageTimestamp(message));
  const disclosure = $derived(m.provenance?.disclosure);
  const renderedText = $derived(renderMention(text, getAliases()));
  // A pure tool-result carrier turn is never its own bubble (folded into the
  // matching tool card, rendered on the assistant turn that made the call).
  const skip = $derived(!error && isToolResultOnly(message));

  // Copy is the one action every surface can honour (a blocked clipboard is
  // not worth interrupting the conversation over).
  const actions = $derived<MessageAction[]>(
    streaming || !text.trim()
      ? []
      : [
          {
            icon: Copy,
            label: msg.chat_copy(),
            confirm: true,
            onclick: () => void navigator.clipboard?.writeText(text).catch(() => {}),
          },
        ],
  );

  useAliasDirectory();
</script>

{#if error}
  <div
    class="max-w-[85%] px-[var(--space-3)] py-[var(--space-2)] rounded-lg text-xs leading-relaxed break-words self-center bg-destructive/15 text-destructive text-[length:var(--font-size-caption)] rounded-md !max-w-[95%] font-mono whitespace-pre-wrap"
  >
    <span>{@html renderedText}</span>
    {#if timestamp}
      <span class="block text-[length:var(--font-size-telemetry)] opacity-70 mt-0.5 text-right"
        >{timestamp}</span
      >
    {/if}
  </div>
{:else if !skip && role === 'user' && text}
  <AiMessage from="user" timestamp={timestamp ?? undefined} {actions}>
    <div
      class="chat-user-message px-[var(--space-3)] py-[var(--space-2)] rounded-lg text-xs leading-relaxed break-words
      bg-accent text-[var(--color-on-accent)] rounded-br-[3px] font-mono whitespace-pre-wrap
      {streaming ? 'opacity-80 border border-dashed border-border' : ''}"
    >
      <span>{@html renderedText}</span>
    </div>
  </AiMessage>
{:else if !skip && role === 'assistant' && assistantHasContent(message)}
  <!-- ChatBlocks owns the answer bubble itself (meta rows outside, reply inside) —
     no extra chrome wrapper here, same as ChatTurn's usage on /home. -->
  <AiMessage from="assistant" timestamp={timestamp ?? undefined} {actions}>
    <ChatBlocks message={m} {streaming} compact />
    <span class="block text-right px-1">
      <AIDisclosureBadge {disclosure} />
    </span>
  </AiMessage>
{/if}
