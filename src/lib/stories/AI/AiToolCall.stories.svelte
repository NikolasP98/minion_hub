<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AiToolCall from '$lib/components/ai/AiToolCall.svelte';

  const input = JSON.stringify({ query: 'bookings next week', limit: 20 }, null, 2);
  const result = JSON.stringify(
    {
      count: 3,
      rows: [
        { id: 'bk-1', when: '2026-11-12 10:00' },
        { id: 'bk-2', when: '2026-11-13 15:30' },
      ],
    },
    null,
    2,
  );
  const longInput = JSON.stringify(
    {
      filters: Array.from({ length: 12 }, (_, i) => ({
        field: `custom_${i}`,
        op: 'contains',
        value: 'a'.repeat(40 + i * 7),
      })),
      sort: [{ field: 'created_at', dir: 'desc' }],
      page: { size: 200, cursor: 'eyJpZCI6ImJrLTk5OTk5IiwidHMiOjE3NjI1NjAwMDB9' },
    },
    null,
    2,
  );
  const longResult = Array.from(
    { length: 60 },
    (_, i) =>
      `${String(i + 1).padStart(3, '0')}  ${['Ana', 'Luis', 'Marta', 'Jorge'][i % 4]} ${'·'.repeat(1 + (i % 5))} ${(i * 1234.5).toFixed(2)}`,
  ).join('\n');

  const { Story } = defineMeta({
    title: 'Components/AI/AiToolCall',
    component: AiToolCall,
    tags: ['autodocs'],
    argTypes: {
      status: { control: 'select', options: ['idle', 'pending', 'running', 'success', 'error'] },
    },
    args: {
      name: 'bookings.search',
      status: 'success',
      input,
      result,
      summary: 'bookings next week',
    },
  });
</script>

<Story name="Pending" args={{ status: 'pending', result: undefined }} />
<Story name="Running" args={{ status: 'running', result: undefined }} />
<Story name="Success collapsed" />
<Story name="Success expanded" args={{ defaultOpen: true }} />
<Story
  name="Error"
  args={{
    status: 'error',
    result: 'PermissionError: the current role cannot read bookings',
    defaultOpen: true,
  }}
/>
<Story
  name="Idle no recorded result"
  args={{ status: 'idle', result: undefined, input: undefined }}
/>
<Story name="Long arguments" args={{ input: longInput, defaultOpen: true }} />
<Story name="Long result" args={{ result: longResult, defaultOpen: true }} />
<Story
  name="Plain label group not mono"
  args={{
    name: '3 tool uses',
    mono: false,
    summary: 'bookings.search · crm.contact.get · fin.invoice.list',
  }}
/>
<Story name="Compact ring chevron only" args={{ compact: true }} />

<Story
  name="Nested group"
  args={{
    name: '3 tool uses',
    mono: false,
    status: 'error',
    summary: 'bookings.search · crm.contact.get · fin.invoice.list',
    defaultOpen: true,
  }}
>
  {#snippet template(args)}
    <AiToolCall {...args}>
      <div class="flex flex-col gap-1 pl-4">
        <AiToolCall
          name="bookings.search"
          status="success"
          {input}
          {result}
          summary="bookings next week"
        />
        <AiToolCall
          name="crm.contact.get"
          status="success"
          input={'{ "id": "ct-42" }'}
          result={'{ "name": "Ana Torres" }'}
        />
        <AiToolCall
          name="fin.invoice.list"
          status="error"
          input={'{ "contactId": "ct-42" }'}
          result="Timeout after 30 s"
          defaultOpen
        />
      </div>
    </AiToolCall>
  {/snippet}
</Story>

<Story name="With meta chips">
  {#snippet template(args)}
    <AiToolCall {...args}>
      {#snippet meta()}
        <span class="rounded-sm bg-surface-1 px-1 t-caption text-muted-foreground">read</span>
      {/snippet}
    </AiToolCall>
  {/snippet}
</Story>

<Story name="Narrow host truncation">
  {#snippet template(args)}
    <div class="w-56">
      <AiToolCall
        {...args}
        name="very.long.tool.namespace.with.many.segments.search"
        summary="a summary long enough to be clipped by the narrow host"
      />
    </div>
  {/snippet}
</Story>
