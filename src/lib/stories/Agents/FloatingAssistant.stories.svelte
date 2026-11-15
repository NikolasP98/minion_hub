<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import FloatingAssistant from '$lib/components/layout/FloatingAssistant.svelte';
  import { closeAssistant, openAssistant } from '$lib/state/features/assistant.svelte';
  import { agentChat, ensureAgentChat } from '$lib/state/chat/chat.svelte';
  import type { AgentChatState, ChatMessage } from '$lib/types/chat';
  import { conn } from '$lib/state/gateway/connection.svelte';

  // The personal agent id and the viewer come from page.data (server load in the app).
  const ID = 'panik-nikolas';
  const pageData = {
    personalAgent: { agent: { agentId: ID } },
    user: { displayName: 'Nikolas Perez', role: 'admin' },
  };
  const t0 = Date.now() - 5 * 60_000;
  const thread: ChatMessage[] = [
    { role: 'user', content: 'How many bookings do I have tomorrow morning?', timestamp: t0 },
    {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Three before noon: 9:00 Ana Torres (cleaning), 10:30 Luis Paredes (consult) and 11:15 a walk-in slot that is still open.',
        },
      ],
      timestamp: t0 + 4_000,
    },
    { role: 'user', content: 'Move the 10:30 to Thursday same time', timestamp: t0 + 60_000 },
    {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Done. Luis Paredes is now Thursday 10:30 and I sent him the WhatsApp confirmation.',
        },
      ],
      timestamp: t0 + 66_000,
    },
  ];

  // Chat/connection state is global; every story resets it and then seeds its own.
  const seed = (patch?: () => void) => async () => {
    closeAssistant();
    Object.assign(conn, { connected: false, connecting: false });
    delete agentChat[ID];
    try {
      localStorage.removeItem(`assistant:session:${ID}`);
    } catch {
      /* ignore */
    }
    patch?.();
  };
  const open =
    (chatPatch?: Partial<AgentChatState>, connected = true) =>
    () => {
      Object.assign(ensureAgentChat(ID), { messages: thread }, chatPatch);
      conn.connected = connected;
      openAssistant();
    };

  // Collapsed pill with the chat seeded, its hover bubble forced open via focus.
  const pill =
    (chatPatch?: Partial<AgentChatState>) =>
    async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      Object.assign(ensureAgentChat(ID), { messages: thread }, chatPatch);
      conn.connected = true;
      await new Promise((r) => setTimeout(r, 50));
      const doc = canvasElement.ownerDocument;
      doc.querySelector<HTMLElement>('.fa-launcher')?.focus({ focusVisible: true } as FocusOptions);
    };
  const toolTurn: ChatMessage[] = [
    ...thread,
    { role: 'user', content: 'Book Ana Torres for a cleaning next Friday', timestamp: t0 + 90_000 },
    {
      role: 'assistant',
      content: [{ type: 'toolCall', id: 'c1', name: 'crm_search_contacts', arguments: '{}' }],
      timestamp: t0 + 92_000,
    } as unknown as ChatMessage,
  ];

  const { Story } = defineMeta({
    title: 'Components/Agents/FloatingAssistant',
    component: FloatingAssistant,
    tags: ['autodocs'],
    parameters: {
      sveltekit_experimental: {
        state: { page: { url: new URL('http://localhost/agents'), data: pageData } },
      },
      docs: { story: { inline: false, height: '640px' } },
    },
  });
</script>

<Story name="Closed launcher pill" play={seed()}>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>

<Story name="Open with thread" play={seed(open())}>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>

<Story name="Open empty thread" play={seed(open({ messages: [] }))}>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>

<Story name="Open disconnected" play={seed(open({}, false))}>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>

<Story
  name="Streaming reply"
  play={seed(
    open({
      sending: true,
      stream:
        'Looking at Thursday now. The 10:30 slot is free, so I will move Luis Paredes there and',
    }),
  )}
>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>

<Story name="Thinking" play={seed(open({ sending: true, stream: '' }))}>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>

<Story
  name="Error"
  play={seed(
    open({
      lastError:
        'The gateway did not acknowledge the message within 15 s. Check the connection and try again.',
    }),
  )}
>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>

<Story
  name="Minimized after open"
  play={seed(() => {
    open()();
    closeAssistant();
  })}
>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>

<Story
  name="Open with thread · Phone"
  globals={{ viewport: { value: 'phone', isRotated: false } }}
  play={seed(open())}
>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>

<Story
  name="Closed launcher pill · Phone"
  globals={{ viewport: { value: 'phone', isRotated: false } }}
  play={seed()}
>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>

<Story
  name="Pill bubble · empty chat"
  play={async (ctx) => (await seed()(), pill({ messages: [] })(ctx))}
>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>

<Story
  name="Pill bubble · using a tool"
  play={async (ctx) => (await seed()(), pill({ messages: toolTurn, sending: true })(ctx))}
>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>

<Story
  name="Pill bubble · writing"
  play={async (ctx) => (
    await seed()(),
    pill({ sending: true, stream: 'Looking at Thursday now.' })(ctx)
  )}
>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>

<Story name="Pill bubble · last reply" play={async (ctx) => (await seed()(), pill()(ctx))}>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>
