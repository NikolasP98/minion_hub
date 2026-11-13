<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import TodoChecklist from '$lib/components/my-agent/TodoChecklist.svelte';
  import {
    notesState,
    type AgentNote,
    type NoteBlock,
    type TodoItem,
  } from '$lib/state/features/agent-notes.svelte';

  // Item edits go through the notes store by note id, so the fixtures live in the store
  // and the stories render the store's own (reactive) copies.
  const now = Date.now();
  const todo = (id: string, text: string, done = false): TodoItem => ({ id, text, done });
  const note = (
    id: string,
    title: string,
    items: TodoItem[],
    blocks: NoteBlock[] = [],
  ): AgentNote => ({
    id,
    kind: blocks.length ? 'note' : 'todo',
    title,
    body: '',
    items,
    attachments: [],
    easel: { items: [] },
    blocks,
    color: 'default',
    pinned: false,
    createdAt: now,
    updatedAt: now,
  });
  const block: Extract<NoteBlock, { type: 'todo' }> = {
    id: 'blk-1',
    type: 'todo',
    title: 'Before opening',
    items: [
      todo('b1', 'Turn on the autoclave'),
      todo('b2', 'Print the day sheet', true),
      todo('b3', 'Check WhatsApp for cancellations'),
    ],
  };
  const fixtures = [
    note('sb-todo-populated', 'Friday close', [
      todo('a1', 'Count the cash drawer'),
      todo('a2', 'Send the daily report', true),
      todo('a3', 'Order gloves and masks'),
      todo('a4', 'Call the two no-shows back and offer Monday slots before they book elsewhere'),
    ]),
    note('sb-todo-empty', 'New list', []),
    note('sb-todo-done', 'Yesterday', [
      todo('c1', 'Confirm Thursday bookings', true),
      todo('c2', 'Pay the water bill', true),
    ]),
    note('sb-todo-block', 'Opening routine', [], [block]),
  ];
  for (const n of fixtures)
    if (!notesState.notes.some((x) => x.id === n.id)) notesState.notes.push(n);
  const byId = (id: string): AgentNote => {
    const n = notesState.notes.find((x) => x.id === id);
    if (!n) throw new Error(`Missing note fixture ${id}`);
    return n;
  };

  const { Story } = defineMeta({
    title: 'Components/Sessions/TodoChecklist',
    component: TodoChecklist,
    tags: ['autodocs'],
    argTypes: { large: { control: 'boolean' } },
    args: { large: false },
  });
</script>

<Story name="Populated">
  {#snippet template(args)}<div class="w-80">
      <TodoChecklist {...args} note={byId('sb-todo-populated')} />
    </div>{/snippet}
</Story>

<Story name="Large">
  {#snippet template(args)}<div class="w-96">
      <TodoChecklist {...args} note={byId('sb-todo-populated')} large />
    </div>{/snippet}
</Story>

<Story name="Empty">
  {#snippet template(args)}<div class="w-80">
      <TodoChecklist {...args} note={byId('sb-todo-empty')} />
    </div>{/snippet}
</Story>

<Story name="All done">
  {#snippet template(args)}<div class="w-80">
      <TodoChecklist {...args} note={byId('sb-todo-done')} />
    </div>{/snippet}
</Story>

<Story name="Embedded block">
  {#snippet template(args)}
    {@const n = byId('sb-todo-block')}
    {@const b = n.blocks[0]}
    <div class="w-80">
      {#if b?.type === 'todo'}<TodoChecklist {...args} note={n} block={b} />{/if}
    </div>
  {/snippet}
</Story>
