<script lang="ts">
  import { extractText, extractMessageTimestamp } from '$lib/utils/text';
  import AIDisclosureBadge from './AIDisclosureBadge.svelte';
  import MarkdownMessage from './MarkdownMessage.svelte';

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
</script>

{#if text || error}
<div
  class="max-w-[85%] px-[11px] py-[7px] rounded-lg text-xs leading-relaxed break-words
    {error
      ? 'self-center bg-destructive/15 text-destructive text-[11px] rounded-md !max-w-[95%] font-mono whitespace-pre-wrap'
      : role === 'user'
        ? 'self-end bg-accent text-white rounded-br-[3px] font-mono whitespace-pre-wrap'
        : 'self-start bg-bg3 text-foreground rounded-bl-[3px]'}
    {streaming ? 'opacity-80 border border-dashed border-border' : ''}"
>
  {#if role === 'assistant' && !error}
    <MarkdownMessage value={text} tone="assistant" />
  {:else}
    {text}
  {/if}
  {#if timestamp}
    <span class="block text-[9px] opacity-70 mt-0.5 text-right">{timestamp}</span>
  {/if}
  {#if role === 'assistant' && !error}
    <span class="block mt-1 text-right">
      <AIDisclosureBadge disclosure={disclosure} />
    </span>
  {/if}
</div>
{/if}
