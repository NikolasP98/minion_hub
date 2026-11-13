<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import ChatTurn from '$lib/components/my-agent/ChatTurn.svelte';
  import type { ChatMessage } from '$lib/types/chat';
  import type { ToolResult } from '$lib/chat/blocks';

  const ts = Date.parse('2026-11-08T10:42:00');
  const tool = (id: string, name: string, input: Record<string, unknown>) => ({
    type: 'tool_use',
    id,
    name,
    input,
  });
  const message = (content: ChatMessage['content']): ChatMessage => ({
    role: 'assistant',
    content,
    timestamp: ts,
  });
  const blocks = [
    { type: 'thinking', thinking: 'Search next week, then the contacts, then summarise.' },
    tool('tu-1', 'bookings.search', { from: '2026-11-10', to: '2026-11-16' }),
    tool('tu-2', 'crm.contact.get', { id: 'ct-42' }),
    { type: 'text', text: 'Three bookings next week: **Tue 10:00**, Wed 15:30 and Fri 09:00.' },
  ];
  const toolResults: Record<string, ToolResult> = {
    'tu-1': { content: '{ "count": 3, "rows": [ … ] }', isError: false },
    'tu-2': { content: '{ "name": "Ana Torres", "phone": "+51 9** *** 123" }', isError: false },
  };
  const artifact = tool('tu-9', 'chat_artifact', {
    title: 'Confirm reminder',
    html: '<p class="m-0">Send 14 reminders from the clinic number?</p>',
    buttons: [
      [
        { text: 'Send', callback_data: 'send', style: 'primary' },
        { text: 'Cancel', callback_data: 'cancel', style: 'danger' },
      ],
    ],
  });

  const { Story } = defineMeta({
    title: 'Components/Chat/ChatTurn',
    component: ChatTurn,
    tags: ['autodocs'],
    argTypes: { streaming: { control: 'boolean' } },
    args: { message: message(blocks), toolResults, onArtifactCallback: fn(), onChoice: fn() },
  });
</script>

<Story name="Text only" args={{ message: message('Plain answer, no steps.'), toolResults: {} }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><ChatTurn {...args} /></div>{/snippet}
</Story>

<Story name="Thinking tools answer done">
  {#snippet template(args)}<div class="w-full max-w-xl"><ChatTurn {...args} /></div>{/snippet}
</Story>

<Story
  name="Streaming tools running no answer yet"
  args={{
    message: message(blocks.slice(0, 3)),
    toolResults: { 'tu-1': toolResults['tu-1'] },
    streaming: true,
  }}
>
  {#snippet template(args)}<div class="w-full max-w-xl"><ChatTurn {...args} /></div>{/snippet}
</Story>

<Story
  name="Streaming with textOverride typewriter"
  args={{ streaming: true, textOverride: 'Three bookings next week: **Tue 10:0' }}
>
  {#snippet template(args)}<div class="w-full max-w-xl"><ChatTurn {...args} /></div>{/snippet}
</Story>

<Story
  name="Tool failed"
  args={{
    toolResults: {
      ...toolResults,
      'tu-2': { content: 'PermissionError: role cannot read contacts', isError: true },
    },
  }}
>
  {#snippet template(args)}<div class="w-full max-w-xl"><ChatTurn {...args} /></div>{/snippet}
</Story>

<Story name="No results recorded idle rings" args={{ toolResults: {} }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><ChatTurn {...args} /></div>{/snippet}
</Story>

<Story
  name="Many tools grouped"
  args={{
    message: message([
      blocks[0],
      ...Array.from({ length: 7 }, (_, i) =>
        tool(`tu-${i}`, ['bookings.search', 'crm.contact.get', 'fin.invoice.list'][i % 3], { i }),
      ),
      blocks[3],
    ]),
    toolResults: {},
  }}
>
  {#snippet template(args)}<div class="w-full max-w-xl"><ChatTurn {...args} /></div>{/snippet}
</Story>

<Story
  name="Web sources"
  args={{
    message: message([
      tool('tu-w', 'web_search', { query: 'SUNAT factura electrónica 2026' }),
      { type: 'text', text: 'Per SUNAT, the deadline moved to March.' },
    ]),
    toolResults: {
      'tu-w': {
        content:
          '[{"url":"https://www.sunat.gob.pe/orientacion/factura","title":"Factura electrónica"},{"url":"https://gob.pe/sunat-2026","title":"Cronograma 2026"}]',
        isError: false,
      },
    },
  }}
>
  {#snippet template(args)}<div class="w-full max-w-xl"><ChatTurn {...args} /></div>{/snippet}
</Story>

<Story name="chat artifact card" args={{ message: message([artifact]), toolResults: {} }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><ChatTurn {...args} /></div>{/snippet}
</Story>

<Story
  name="chat artifact no send path disabled"
  args={{ message: message([artifact]), toolResults: {}, onArtifactCallback: undefined }}
>
  {#snippet template(args)}<div class="w-full max-w-xl"><ChatTurn {...args} /></div>{/snippet}
</Story>

<Story
  name="User turn"
  args={{
    message: { role: 'user', content: 'What do I have next week?', timestamp: ts },
    toolResults: {},
  }}
>
  {#snippet template(args)}<div class="w-full max-w-xl"><ChatTurn {...args} /></div>{/snippet}
</Story>
