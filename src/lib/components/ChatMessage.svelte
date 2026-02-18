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

<div class="chat-msg {error ? 'error' : role} {streaming ? 'stream' : ''}">
  {text}
</div>

<style>
  .chat-msg {
    max-width: 85%; padding: 7px 11px; border-radius: 8px;
    font-size: 12px;
    font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    line-height: 1.5; word-wrap: break-word; white-space: pre-wrap;
  }
  .chat-msg.user {
    align-self: flex-end;
    background: var(--accent); color: #fff;
    border-bottom-right-radius: 3px;
  }
  .chat-msg.assistant {
    align-self: flex-start;
    background: var(--bg3); color: var(--text);
    border-bottom-left-radius: 3px;
  }
  .chat-msg.error {
    align-self: center;
    background: rgba(239,68,68,0.15); color: var(--red);
    font-size: 11px; border-radius: 6px; max-width: 95%;
  }
  .chat-msg.stream {
    opacity: 0.8;
    border: 1px dashed var(--border);
  }
</style>
