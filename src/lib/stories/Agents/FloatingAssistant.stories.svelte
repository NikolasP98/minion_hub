<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import FloatingAssistant from '$lib/components/layout/FloatingAssistant.svelte';
  import { closeAssistant, openAssistant } from '$lib/state/features/assistant.svelte';
  import { agentChat, ensureAgentChat } from '$lib/state/chat/chat.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';

  // The personal agent id and the viewer come from page.data (server load in the app).
  const ID = 'panik-nikolas';
  const pageData = { personalAgent: { agent: { agentId: ID } }, user: { displayName: 'Nikolas Perez', role: 'admin' } };
  const t0 = Date.now() - 5 * 60_000;
  const thread = [
    { role: 'user', content: 'How many bookings do I have tomorrow morning?', timestamp: t0 },
    { role: 'assistant', content: [{ type: 'text', text: 'Three before noon: 9:00 Ana Torres (cleaning), 10:30 Luis Paredes (consult) and 11:15 a walk-in slot that is still open.' }], timestamp: t0 + 4_000 },
    { role: 'user', content: 'Move the 10:30 to Thursday same time', timestamp: t0 + 60_000 },
    { role: 'assistant', content: [{ type: 'text', text: 'Done. Luis Paredes is now Thursday 10:30 and I sent him the WhatsApp confirmation.' }], timestamp: t0 + 66_000 },
  ];

  // Chat/connection state is global; every story resets it and then seeds its own.
  const seed = (patch) => async () => {
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
  const open = (chatPatch, connected = true) => () => {
    Object.assign(ensureAgentChat(ID), { messages: thread }, chatPatch);
    conn.connected = connected;
    openAssistant();
  };

  const { Story } = defineMeta({
    title: 'Agents/FloatingAssistant',
    component: FloatingAssistant,
    tags: ['autodocs'],
    parameters: {
      sveltekit_experimental: { state: { page: { url: new URL('http://localhost/agents'), data: pageData } } },
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

<Story name="Streaming reply" play={seed(open({ sending: true, stream: 'Looking at Thursday now. The 10:30 slot is free, so I will move Luis Paredes there and' }))}>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>

<Story name="Thinking" play={seed(open({ sending: true, stream: '' }))}>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>

<Story name="Error" play={seed(open({ lastError: 'The gateway did not acknowledge the message within 15 s. Check the connection and try again.' }))}>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>

<Story name="Minimized after open" play={seed(() => { open()(); closeAssistant(); })}>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>

<Story name="Open with thread · Phone" globals={{ viewport: { value: 'phone', isRotated: false } }} play={seed(open())}>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>

<Story name="Closed launcher pill · Phone" globals={{ viewport: { value: 'phone', isRotated: false } }} play={seed()}>
  {#snippet template()}<FloatingAssistant />{/snippet}
</Story>
