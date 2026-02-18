<script lang="ts">
  import ChatMessage from './ChatMessage.svelte';
  import { agentChat } from '$lib/state/chat.svelte';
  import { sendChatMsg } from '$lib/services/gateway.svelte';
  import { conn } from '$lib/state/connection.svelte';
  import { extractText } from '$lib/utils/text';
  import { tick } from 'svelte';

  let { agentId }: { agentId: string } = $props();

  const chat = $derived(agentChat[agentId]);
  let messagesEl = $state<HTMLDivElement | null>(null);
  let atBottom = $state(true);

  function handleScroll() {
    if (!messagesEl) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesEl;
    atBottom = scrollHeight - scrollTop - clientHeight < 40;
  }

  $effect(() => {
    if (!chat) return;
    // Touch stream/messages to subscribe
    void chat.messages.length;
    void chat.stream;
    if (atBottom) {
      tick().then(() => {
        if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
      });
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMsg(agentId);
    }
  }
</script>

<div class="chat-section">
  <div
    class="chat-messages"
    bind:this={messagesEl}
    onscroll={handleScroll}
  >
    {#if !chat || (chat.messages.length === 0 && !chat.stream && !chat.loading)}
      <div class="chat-empty">No messages yet. Say hello!</div>
    {:else if chat.loading}
      <div class="chat-empty">Loading history…</div>
    {:else}
      {#each chat.messages as msg, i (i)}
        <ChatMessage message={msg} />
      {/each}

      {#if chat.stream !== null}
        {#if chat.stream === ''}
          <div class="typing">
            <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          </div>
        {:else}
          <ChatMessage message={{ role: 'assistant', content: chat.stream }} streaming={true} />
        {/if}
      {/if}

      {#if chat.lastError}
        <ChatMessage message={{ role: 'assistant', content: `Error: ${chat.lastError}` }} error={true} />
      {/if}
    {/if}
  </div>

  <div class="chat-input-row">
    <textarea
      class="chat-input"
      placeholder={conn.connected ? 'Type a message… (Enter to send)' : 'Not connected'}
      disabled={!conn.connected || (chat?.sending ?? false)}
      value={chat?.inputText ?? ''}
      oninput={(e) => { if (chat) chat.inputText = (e.target as HTMLTextAreaElement).value; }}
      onkeydown={handleKeydown}
      rows="1"
    ></textarea>
    <button
      class="chat-send"
      disabled={!conn.connected || (chat?.sending ?? false) || !(chat?.inputText?.trim())}
      onclick={() => sendChatMsg(agentId)}
    >Send</button>
  </div>
</div>

<style>
  .chat-section {
    flex: 1; min-height: 0;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .chat-messages {
    flex: 1; min-height: 0;
    overflow-y: auto; padding: 10px 16px;
    display: flex; flex-direction: column; gap: 6px;
    scrollbar-width: thin; scrollbar-color: var(--border) transparent;
  }
  .chat-empty {
    color: var(--text3); font-size: 11px;
    text-align: center; padding: 20px; font-family: inherit;
  }
  .typing {
    display: flex; gap: 4px; padding: 4px 8px;
    align-items: center; align-self: flex-start;
  }
  .dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--text3);
    animation: typing-bounce 0.6s ease infinite;
  }
  .dot:nth-child(2) { animation-delay: 0.15s; }
  .dot:nth-child(3) { animation-delay: 0.3s; }
  @keyframes typing-bounce {
    0%, 100% { transform: translateY(0); opacity: 0.4; }
    50% { transform: translateY(-5px); opacity: 1; }
  }
  .chat-input-row {
    flex-shrink: 0; display: flex; gap: 8px;
    padding: 10px 16px; border-top: 1px solid var(--border);
  }
  .chat-input {
    flex: 1; background: var(--bg3); border: 1px solid var(--border);
    border-radius: 6px; color: var(--text); padding: 7px 12px;
    font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    font-size: 12px; outline: none; resize: none;
    min-height: 32px; max-height: 80px;
    field-sizing: content;
  }
  .chat-input:focus { border-color: var(--accent); }
  .chat-send {
    background: var(--accent); color: #fff; border: none;
    border-radius: 6px; padding: 0 14px;
    font-family: inherit; font-size: 12px; font-weight: 600;
    cursor: pointer; transition: all 0.2s; flex-shrink: 0;
  }
  .chat-send:hover { filter: brightness(1.15); }
  .chat-send:disabled { opacity: 0.4; cursor: default; }
</style>
