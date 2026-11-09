<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import { Copy, Pencil, RotateCcw, ThumbsUp } from 'lucide-svelte';
  import AiMessage from '$lib/components/ai/AiMessage.svelte';
  import MarkdownMessage from '$lib/components/chat/MarkdownMessage.svelte';

  // AiMessage is only the row: side, timestamp, hover actions. The bubble is the child.
  const actions = [
    { icon: Copy, label: 'Copy', onclick: fn(), confirm: true },
    { icon: RotateCcw, label: 'Retry', onclick: fn() },
    { icon: ThumbsUp, label: 'Good answer', onclick: fn() },
  ];
  const sqlReply =
    'Here is the query:\n\n```sql\nselect id, starts_at from bookings\nwhere starts_at >= now()\norder by starts_at;\n```\n\n- 3 rows\n- **none** cancelled';
  const long = 'This reply goes on for a while so the row has to wrap. '.repeat(14);

  const { Story } = defineMeta({
    title: 'AI/AiMessage',
    component: AiMessage,
    tags: ['autodocs'],
    argTypes: { from: { control: 'select', options: ['user', 'assistant'] } },
    args: { from: 'assistant', timestamp: '10:42', actions },
  });
</script>

{#snippet bubble(text, user = false)}
  <div
    class="rounded-lg px-3 py-2 t-body {user
      ? 'bg-accent text-on-accent'
      : 'bg-surface-2 text-foreground'}"
  >
    {text}
  </div>
{/snippet}

<Story name="Assistant">
  {#snippet template(args)}
    <div class="flex w-full flex-col">
      <AiMessage {...args}
        >{@render bubble(
          'Three bookings next week: Tue 10:00, Wed 15:30 and Fri 09:00.',
        )}</AiMessage
      >
    </div>
  {/snippet}
</Story>

<Story
  name="User"
  args={{ from: 'user', actions: [{ icon: Pencil, label: 'Edit', onclick: fn() }] }}
>
  {#snippet template(args)}
    <div class="flex w-full flex-col">
      <AiMessage {...args}>{@render bubble('What do I have next week?', true)}</AiMessage>
    </div>
  {/snippet}
</Story>

<Story name="No timestamp no actions" args={{ timestamp: undefined, actions: [] }}>
  {#snippet template(args)}
    <div class="flex w-full flex-col">
      <AiMessage {...args}>{@render bubble('Bare row: just the bubble.')}</AiMessage>
    </div>
  {/snippet}
</Story>

<Story name="Long wraps at 85 pct">
  {#snippet template(args)}
    <div class="flex w-full flex-col"><AiMessage {...args}>{@render bubble(long)}</AiMessage></div>
  {/snippet}
</Story>

<Story name="Markdown child code block">
  {#snippet template(args)}
    <div class="flex w-full flex-col">
      <AiMessage {...args}>
        <div class="rounded-lg bg-surface-2 px-3 py-2">
          <MarkdownMessage value={sqlReply} />
        </div>
      </AiMessage>
    </div>
  {/snippet}
</Story>

<Story name="Thread both sides">
  {#snippet template(args)}
    <div class="flex w-full flex-col gap-3">
      <AiMessage {...args} from="user" timestamp="10:41" actions={[]}
        >{@render bubble('What do I have next week?', true)}</AiMessage
      >
      <AiMessage {...args}
        >{@render bubble(
          'Three bookings next week: Tue 10:00, Wed 15:30 and Fri 09:00.',
        )}</AiMessage
      >
      <AiMessage {...args} from="user" timestamp="10:43" actions={[]}
        >{@render bubble('Move the Friday one to Monday.', true)}</AiMessage
      >
      <AiMessage {...args} timestamp="10:43">{@render bubble(long)}</AiMessage>
    </div>
  {/snippet}
</Story>

<Story name="Thread · Phone" globals={{ viewport: { value: 'phone', isRotated: false } }}>
  {#snippet template(args)}
    <div class="flex w-full flex-col gap-3">
      <AiMessage {...args} from="user" timestamp="10:41" actions={[]}
        >{@render bubble('What do I have next week?', true)}</AiMessage
      >
      <AiMessage {...args}>{@render bubble(long)}</AiMessage>
    </div>
  {/snippet}
</Story>
