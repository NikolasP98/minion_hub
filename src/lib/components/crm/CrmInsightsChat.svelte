<script lang="ts">
  /**
   * Embedded agent chat for /crm/insights — reuses the SAME gateway chat
   * plumbing as FloatingAssistant.svelte (sendAssistantTurn, ensureAgentChat,
   * the streaming smoother), just mounted inline instead of floating, and
   * framed with buildInsightsContext() instead of buildAssistantContext().
   *
   * ponytail: this binds to the user's personal agent's MAIN session (same
   * thread FloatingAssistant shows on every other page) rather than a truly
   * isolated "crm-insights" session. `agentChat` state and the gateway event
   * router (parseAgentId in gateway.svelte.ts) both key strictly by agentId,
   * not by session — giving this panel a separate live thread would mean
   * teaching that shared, heavily-consumed state model to key by
   * (agentId, sessionKey) instead, which is out of scope for a UI-only page
   * and risks regressing every other chat surface. One agent, one thread,
   * context varies by page — exactly how the floating assistant already
   * works across the rest of the hub. Upgrade to a real per-session store if
   * a dedicated, non-shared insights thread is ever required.
   */
  import { tick } from 'svelte';
  import { Sparkles, Send, AlertCircle } from 'lucide-svelte';
  import { Button, iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { assistant } from '$lib/state/features/assistant.svelte';
  import { agentChat } from '$lib/state/chat/chat.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import {
    sendAssistantTurn,
    loadChatHistory,
    cleanInboundForDisplay,
  } from '$lib/services/gateway.svelte';
  import { buildInsightsContext } from '$lib/state/features/assistant-context';
  import { extractText, stripTtsTags } from '$lib/utils/text';
  import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';
  import ChatBlocks from '$lib/chat/ChatBlocks.svelte';
  import {
    isToolResultOnly,
    assistantHasContent,
    toolResultsById as computeToolResultsById,
  } from '$lib/chat/blocks';

  const SUGGESTED: Array<() => string> = [
    () => m.crm_insights_chat_q1(),
    () => m.crm_insights_chat_q2(),
    () => m.crm_insights_chat_q3(),
  ];

  let draft = $state('');
  let inputEl: HTMLTextAreaElement | undefined = $state();
  let messagesEl: HTMLDivElement | null = $state(null);
  let atBottom = $state(true);

  const agentId = $derived(assistant.personalAgentId);
  const chat = $derived(agentId ? agentChat[agentId] : undefined);
  const messages = $derived(chat?.messages ?? []);
  const sending = $derived(chat?.sending ?? false);
  const stream = $derived(chat?.stream ?? null);
  const toolResultsById = $derived(computeToolResultsById(messages));

  const canSend = $derived(!!agentId && conn.connected && !sending);

  // Lazy-load history the first time this panel sees a connected agent —
  // mirrors FloatingAssistant's effect (same session, so if the floating
  // assistant already loaded it this is a no-op).
  $effect(() => {
    if (agentId && conn.connected) {
      const existing = agentChat[agentId];
      if (!existing || existing.messages.length === 0) loadChatHistory(agentId);
    }
  });

  function scrollToBottom() {
    tick().then(() => {
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }
  function handleScroll() {
    if (!messagesEl) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesEl;
    atBottom = scrollHeight - scrollTop - clientHeight < 40;
  }
  $effect(() => {
    void messages.length;
    void stream;
    if (atBottom) scrollToBottom();
  });

  function send() {
    if (!agentId || !canSend) return;
    const text = draft.trim();
    if (!text) return;
    sendAssistantTurn(agentId, text, buildInsightsContext());
    draft = '';
    atBottom = true;
  }
  function onInputKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
  function fillSuggested(q: string) {
    draft = q;
    inputEl?.focus();
  }

  function msgRole(msg: unknown): 'user' | 'assistant' {
    return (msg as { role?: string }).role === 'user' ? 'user' : 'assistant';
  }
  function msgTs(msg: unknown): number | undefined {
    return (msg as { timestamp?: number }).timestamp;
  }
</script>

<section class="card">
  <header class="card-h">
    <span class="flex items-center gap-1.5"
      ><Sparkles size={iconSizes.sm} class="text-accent" /> {m.crm_insights_chat_title()}</span
    >
  </header>

  <div class="chips" role="group" aria-label={m.crm_insights_chat_title()}>
    {#each SUGGESTED as q (q)}
      <Button variant="outline" size="sm" onclick={() => fillSuggested(q())}>{q()}</Button>
    {/each}
  </div>

  <div class="messages" bind:this={messagesEl} onscroll={handleScroll}>
    {#if !agentId}
      <div class="cic-empty">
        <AlertCircle size={iconSizes.md} class="text-muted-foreground" />
        <p class="t-caption">{assistant.error ?? m.floatingAssistant_connecting()}</p>
      </div>
    {:else if messages.length === 0 && !chat?.loading && !stream}
      <div class="cic-empty">
        <Sparkles size={iconSizes.md} class="text-accent" />
        <p class="t-body">{m.crm_insights_chat_greeting()}</p>
      </div>
    {:else}
      {#each messages as msg, i (`${msgTs(msg) ?? ''}_${i}`)}
        {@const role = msgRole(msg)}
        {#if isToolResultOnly(msg)}
          <!-- tool-output carrier turn — folded into the matching tool card -->
        {:else if role === 'user'}
          {@const text = cleanInboundForDisplay(extractText(msg) ?? '')}
          {#if text}
            <div class="row row-user">
              <div class="bubble bubble-user">{text}</div>
            </div>
          {/if}
        {:else if assistantHasContent(msg)}
          <div class="row row-assistant">
            <ChatBlocks message={msg} toolResults={toolResultsById} compact />
          </div>
        {/if}
      {/each}

      {#if stream !== null && stream !== ''}
        <div class="row row-assistant">
          <div class="bubble bubble-stream">
            <MarkdownMessage value={stripTtsTags(stream)} tone="assistant" />
          </div>
        </div>
      {:else if sending}
        <div class="thinking">
          <span class="dot"></span><span class="dot" style="animation-delay:100ms"></span><span
            class="dot"
            style="animation-delay:200ms"
          ></span>
          {m.crm_insights_chat_thinking()}
        </div>
      {/if}

      {#if chat?.lastError}
        <div class="cic-error">
          <AlertCircle size={iconSizes.xs} />
          <span>{chat.lastError}</span>
        </div>
      {/if}
    {/if}
  </div>

  {#if !conn.connected}
    <p class="t-caption cic-offline">{m.crm_insights_chat_offline()}</p>
  {/if}

  <div class="composer">
    <textarea
      bind:this={inputEl}
      bind:value={draft}
      onkeydown={onInputKey}
      rows="1"
      placeholder={m.crm_insights_chat_placeholder()}
      disabled={!canSend}
      class="cic-input"
    ></textarea>
    <Button
      variant="ghost"
      size="sm"
      onclick={send}
      disabled={!draft.trim() || !canSend}
      aria-label={m.crm_insights_chat_send()}
      class="cic-send"
    >
      <Send size={iconSizes.sm} />
    </Button>
  </div>
</section>

<style>
  .card {
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--color-card);
    padding: var(--space-4, 16px);
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 12px);
  }
  .card-h {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2, 8px);
    font-size: var(--font-size-body, 14px);
    font-weight: 600;
    color: var(--color-muted-foreground);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2, 8px);
  }
  .messages {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 8px);
    min-height: 12rem;
    max-height: 22rem;
    overflow-y: auto;
    padding-right: var(--space-1, 4px);
  }
  .cic-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: var(--space-2, 8px);
    padding: var(--space-6, 24px) var(--space-4, 16px);
    color: var(--color-muted-foreground);
  }
  .row {
    display: flex;
  }
  .row-user {
    justify-content: flex-end;
  }
  .row-assistant {
    justify-content: flex-start;
  }
  .bubble {
    max-width: 85%;
    border-radius: var(--radius-lg);
    padding: var(--space-2, 8px) var(--space-3, 12px);
    font-size: var(--font-size-body, 14px);
    line-height: 1.4;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .bubble-user {
    background: color-mix(in srgb, var(--color-accent) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-accent) 20%, transparent);
    color: var(--color-foreground);
  }
  .bubble-stream {
    background: var(--color-surface-2);
    border: 1px dashed var(--hairline);
    opacity: 0.9;
  }
  .thinking {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    padding: var(--space-2, 8px) var(--space-1, 4px);
    color: var(--color-muted-foreground);
    font-size: var(--font-size-caption, 12px);
  }
  .dot {
    width: 0.25rem;
    height: 0.25rem;
    border-radius: var(--radius-full);
    background: var(--color-accent);
    animation: cic-pulse 1.2s ease-in-out infinite;
  }
  @keyframes cic-pulse {
    0%,
    80%,
    100% {
      opacity: 0.3;
    }
    40% {
      opacity: 1;
    }
  }
  .cic-error {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2, 8px);
    padding: var(--space-2, 8px);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--color-danger-fg) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--color-danger-fg) 20%, transparent);
    color: var(--color-danger-fg);
    font-size: var(--font-size-caption, 12px);
  }
  .cic-offline {
    color: var(--color-warning-fg);
  }
  .composer {
    display: flex;
    align-items: flex-end;
    gap: var(--space-2, 8px);
  }
  .cic-input {
    flex: 1;
    min-width: 0;
    resize: none;
    max-height: 7rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--hairline);
    background: var(--color-canvas);
    color: var(--color-foreground);
    padding: var(--space-2, 8px) var(--space-3, 12px);
    font-size: var(--font-size-body, 14px);
    font-family: inherit;
  }
  .cic-input:focus {
    outline: none;
    border-color: color-mix(in srgb, var(--color-accent) 50%, var(--hairline));
  }
  .cic-input:disabled {
    opacity: 0.5;
  }
  :global(.cic-send) {
    flex-shrink: 0;
  }
</style>
