<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import TodoChecklist from '$lib/components/my-agent/TodoChecklist.svelte';
  import { notesState } from '$lib/state/features/agent-notes.svelte';

  // Item edits go through the notes store by note id, so the fixtures live in the store
  // and the stories render the store's own (reactive) copies.
  const now = Date.now();
  const todo = (id, text, done = false) => ({ id, text, done });
  const note = (id, title, items, blocks = []) => ({
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
  const block = {
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
  const byId = (id) => notesState.notes.find((n) => n.id === id);

  const { Story } = defineMeta({
    title: 'Sessions/TodoChecklist',
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
    <div class="w-80"><TodoChecklist {...args} note={n} block={n.blocks[0]} /></div>
  {/snippet}
</Story>
