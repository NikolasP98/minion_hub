<script lang="ts">
  import { onMount } from 'svelte';
  import { extractText, extractMessageTimestamp } from '$lib/utils/text';
  import AIDisclosureBadge from './AIDisclosureBadge.svelte';
  import ChatBlocks from '$lib/chat/ChatBlocks.svelte';
  import { isToolResultOnly, assistantHasContent } from '$lib/chat/blocks';
  import { ensureAliases, getAliases } from '$lib/state/features/aliases.svelte';
  import { renderMention } from '$lib/utils/mention';

  let { message, streaming = false, error = false }: {
    message: unknown;
    streaming?: boolean;
    error?: boolean;
  } = $props();

  const m = $derived(message as { role?: string; content?: unknown; provenance?: { disclosure?: string } });
  const text = $derived(extractText(message) ?? '');
  const role = $derived(m.role === 'user' ? 'user' : 'assistant');
  const timestamp = $derived(extractMessageTimestamp(message));
  const disclosure = $derived(m.provenance?.disclosure);
  const renderedText = $derived(renderMention(text, getAliases()));
  // A pure tool-result carrier turn is never its own bubble (folded into the
  // matching tool card, rendered on the assistant turn that made the call).
  const skip = $derived(!error && isToolResultOnly(message));

  onMount(() => {
    void ensureAliases();
  });
</script>

{#if error}
<div class="max-w-[85%] px-[11px] py-[7px] rounded-lg text-xs leading-relaxed break-words self-center bg-destructive/15 text-destructive text-[11px] rounded-md !max-w-[95%] font-mono whitespace-pre-wrap">
  <span>{@html renderedText}</span>
  {#if timestamp}
    <span class="block text-[9px] opacity-70 mt-0.5 text-right">{timestamp}</span>
  {/if}
</div>
{:else if !skip && role === 'user' && text}
<div
  class="max-w-[85%] px-[11px] py-[7px] rounded-lg text-xs leading-relaxed break-words
    self-end bg-accent text-white rounded-br-[3px] font-mono whitespace-pre-wrap
    {streaming ? 'opacity-80 border border-dashed border-border' : ''}"
>
  <span>{@html renderedText}</span>
  {#if timestamp}
    <span class="block text-[9px] opacity-70 mt-0.5 text-right">{timestamp}</span>
  {/if}
</div>
{:else if !skip && role === 'assistant' && assistantHasContent(message)}
<!-- ChatBlocks owns the answer bubble itself (meta rows outside, reply inside) —
     no extra chrome wrapper here, same as ChatTurn's usage on /home. -->
<div class="max-w-[85%] flex flex-col items-start gap-0.5">
  <ChatBlocks message={m} {streaming} compact />
  {#if timestamp}
    <span class="block text-[9px] opacity-70 text-right px-1">{timestamp}</span>
  {/if}
  <span class="block text-right px-1">
    <AIDisclosureBadge disclosure={disclosure} />
  </span>
</div>
{/if}
