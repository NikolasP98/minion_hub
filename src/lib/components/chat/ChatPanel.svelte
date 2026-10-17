<script lang="ts">
  import { AiConversation, AiPromptInput } from '$lib/components/ai';
  import ChatMessage from './ChatMessage.svelte';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';
  import { agentChat } from '$lib/state/chat/chat.svelte';
  import { sendChatMsg, abortChat } from '$lib/services/gateway.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import * as m from '$lib/paraglide/messages';
  import { iconSizes } from '$lib/components/ui';
  import ThinkingShader from '$lib/components/assistant/ThinkingShader.svelte';

  let { agentId, readonly = false }: { agentId: string; readonly?: boolean } = $props();

  const chat = $derived(agentChat[agentId]);
  // Changes whenever the thread grows, so the conversation knows to follow.
  const contentKey = $derived(`${chat?.messages.length ?? 0}:${chat?.stream?.length ?? -1}`);
  const running = $derived(!!chat && (chat.sending || chat.stream !== null));
</script>

<div class="{readonly ? 'shrink-0' : 'flex-1 min-h-0'} flex flex-col overflow-hidden">
  {#if !readonly}
    <AiConversation class="flex-1 min-h-0" viewportClass="px-4 py-2.5" {contentKey}>
      <div class="flex flex-col gap-1.5">
        {#if !chat || (chat.messages.length === 0 && !chat.stream && !chat.loading)}
          <div class="text-muted-foreground text-[length:var(--font-size-caption)] text-center p-5">
            {m.chat_noMessages()}
          </div>
        {:else if chat.loading}
          <!-- Skeleton chat bubbles -->
          <div class="flex flex-col gap-3 py-2">
            <div class="self-start max-w-[70%] flex flex-col gap-1.5">
              <Skeleton width="180px" height="14px" rounded="rounded" />
              <Skeleton width="220px" height="14px" rounded="rounded" />
              <Skeleton width="140px" height="14px" rounded="rounded" />
            </div>
            <div class="self-end max-w-[60%] flex flex-col gap-1.5 items-end">
              <Skeleton width="120px" height="14px" rounded="rounded" />
              <Skeleton width="160px" height="14px" rounded="rounded" />
            </div>
            <div class="self-start max-w-[70%] flex flex-col gap-1.5">
              <Skeleton width="200px" height="14px" rounded="rounded" />
              <Skeleton width="100px" height="14px" rounded="rounded" />
            </div>
          </div>
        {:else}
          {#each chat.messages as msg, i (`${(msg as { timestamp?: number }).timestamp ?? ''}_${i}`)}
            <ChatMessage message={msg} />
          {/each}

          {#if chat.stream !== null}
            {#if chat.stream === ''}
              <div
                class="flex gap-2 px-2 py-1 items-center self-start text-muted-foreground t-caption"
              >
                <ThinkingShader size={iconSizes.md} />
                {m.ai_thinking()}…
              </div>
            {:else}
              <ChatMessage
                message={{
                  role: 'assistant',
                  content: chat.stream,
                }}
                streaming={true}
              />
            {/if}
          {/if}

          {#if chat.lastError}
            <ChatMessage
              message={{
                role: 'assistant',
                content: `Error: ${chat.lastError}`,
              }}
              error={true}
            />
          {/if}
        {/if}
      </div>
    </AiConversation>
  {/if}

  <div class="shrink-0 px-4 py-2.5 border-t border-border {readonly ? 'opacity-60' : ''}">
    <AiPromptInput
      compact
      bind:value={
        () => chat?.inputText ?? '',
        (v) => {
          if (chat) chat.inputText = v;
        }
      }
      placeholder={readonly
        ? m.chat_viewingSession()
        : conn.connected
          ? m.chat_placeholderGeneric()
          : m.conn_notConnected()}
      disabled={readonly || !conn.connected}
      status={running ? 'streaming' : chat?.lastError ? 'error' : 'idle'}
      onsubmit={() => sendChatMsg(agentId)}
      onstop={() => void abortChat(agentId)}
    />
  </div>
</div>
