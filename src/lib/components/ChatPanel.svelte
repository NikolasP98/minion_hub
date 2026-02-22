<script lang="ts">
  import ChatMessage from './ChatMessage.svelte';
  import { agentChat } from '$lib/state/chat.svelte';
  import { sendChatMsg } from '$lib/services/gateway.svelte';
  import { conn } from '$lib/state/connection.svelte';
  import { extractText } from '$lib/utils/text';
  import { tick } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  let { agentId, readonly = false }: { agentId: string; readonly?: boolean } = $props();

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

<div class="{readonly ? 'shrink-0' : 'flex-1 min-h-0'} flex flex-col overflow-hidden">
  {#if !readonly}
    <div
      class="flex-1 min-h-0 overflow-y-auto px-4 py-2.5 flex flex-col gap-1.5 [scrollbar-width:thin] [scrollbar-color:var(--color-border)_transparent]"
      bind:this={messagesEl}
      onscroll={handleScroll}
    >
      {#if !chat || (chat.messages.length === 0 && !chat.stream && !chat.loading)}
        <div class="text-muted-foreground text-[11px] text-center p-5">{m.chat_noMessages()}</div>
      {:else if chat.loading}
        <div class="text-muted-foreground text-[11px] text-center p-5">{m.chat_loadingHistory()}</div>
      {:else}
        {#each chat.messages as msg, i (i)}
          <ChatMessage message={msg} />
        {/each}

        {#if chat.stream !== null}
          {#if chat.stream === ''}
            <div class="flex gap-1 px-2 py-1 items-center self-start">
              <span class="size-1.5 rounded-full bg-muted-foreground animate-typing-bounce"></span>
              <span class="size-1.5 rounded-full bg-muted-foreground animate-typing-bounce [animation-delay:0.15s]"></span>
              <span class="size-1.5 rounded-full bg-muted-foreground animate-typing-bounce [animation-delay:0.3s]"></span>
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
  {/if}

  <div class="shrink-0 flex gap-2 px-4 py-2.5 border-t border-border {readonly ? 'opacity-60' : ''}">
    <textarea
      class="flex-1 bg-bg3 border border-border rounded-md text-foreground px-3 py-[7px] font-mono text-xs outline-none resize-none min-h-8 max-h-20 [field-sizing:content] focus:border-accent"
      placeholder={readonly
        ? 'Viewing session \u2014 switch to main to chat'
        : conn.connected
          ? m.chat_placeholderGeneric()
          : m.conn_notConnected()}
      disabled={readonly || !conn.connected || (chat?.sending ?? false)}
      value={chat?.inputText ?? ''}
      oninput={(e) => { if (chat) chat.inputText = (e.target as HTMLTextAreaElement).value; }}
      onkeydown={handleKeydown}
      rows="1"
    ></textarea>
    <button
      class="bg-accent text-white border-0 rounded-md px-3.5 text-xs font-semibold cursor-pointer transition-all duration-200 shrink-0 hover:brightness-[1.15] disabled:opacity-40 disabled:cursor-default"
      disabled={readonly || !conn.connected || (chat?.sending ?? false) || !(chat?.inputText?.trim())}
      onclick={() => sendChatMsg(agentId)}
    >{m.chat_send()}</button>
  </div>
</div>
