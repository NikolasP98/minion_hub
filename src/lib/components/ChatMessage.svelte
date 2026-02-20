<script lang="ts">
  import { extractText } from '$lib/utils/text';

  let { message, streaming = false, error = false }: {
    message: unknown;
    streaming?: boolean;
    error?: boolean;
  } = $props();

  const m = $derived(message as { role?: string; content?: unknown });
  const text = $derived(extractText(message) ?? String((message as { content?: unknown })?.content ?? ''));
  const role = $derived(m.role === 'user' ? 'user' : 'assistant');
</script>

<div
  class="max-w-[85%] px-[11px] py-[7px] rounded-lg text-xs font-mono leading-relaxed break-words whitespace-pre-wrap
    {error
      ? 'self-center bg-destructive/15 text-destructive text-[11px] rounded-md !max-w-[95%]'
      : role === 'user'
        ? 'self-end bg-accent text-white rounded-br-[3px]'
        : 'self-start bg-bg3 text-foreground rounded-bl-[3px]'}
    {streaming ? 'opacity-80 border border-dashed border-border' : ''}"
>
  {text}
</div>
