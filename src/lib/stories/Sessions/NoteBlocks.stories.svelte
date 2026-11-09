<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import NoteBlocks from '$lib/components/my-agent/NoteBlocks.svelte';
  import { notesState } from '$lib/state/features/agent-notes.svelte';

  // Block edits go through the notes store by note id, so the fixtures live in the store
  // and the stories render the store's own (reactive) copies.
  const now = Date.now();
  const text = (id, md) => ({ id, type: 'text', md, attachments: [] });
  const todo = (id, title, items) => ({ id, type: 'todo', title, items });
  const easel = (id, title, items = []) => ({ id, type: 'easel', title, items });
  const note = (id, title, blocks) => ({
    id,
    kind: 'note',
    title,
    body: '',
    items: [],
    attachments: [],
    easel: { items: [] },
    blocks,
    color: 'default',
    pinned: false,
    createdAt: now,
    updatedAt: now,
  });
  const fixtures = [
    note('sb-nb-mixed', 'Launch plan', [
      text(
        't1',
        '# Spring promo\n\nTwo weeks of **20% off** on cleanings, pushed over WhatsApp to patients who have not visited in six months.',
      ),
      todo('d1', 'Before launch', [
        { id: 'i1', text: 'Draft the WhatsApp template', done: true },
        { id: 'i2', text: 'Get the template approved', done: false },
        { id: 'i3', text: 'Export the patient list', done: false },
      ]),
      text('t2', 'Open question: do we include orthodontic patients or only general cleaning?'),
      easel('e1', 'Mood board', [
        {
          id: 'x1',
          type: 'text',
          text: 'Fresh, bright, no stock photos',
          x: 20,
          y: 20,
          w: 200,
          h: 80,
          rotation: 0,
          z: 0,
        },
        {
          id: 'x2',
          type: 'text',
          text: 'Teal accent',
          x: 240,
          y: 60,
          w: 120,
          h: 40,
          rotation: 0,
          z: 1,
        },
      ]),
    ]),
    note('sb-nb-text', 'Quick note', [
      text('t3', 'Call the lab about the crown for Luis Paredes before Friday.'),
    ]),
    note('sb-nb-empty', 'Empty note', []),
  ];
  for (const n of fixtures)
    if (!notesState.notes.some((x) => x.id === n.id)) notesState.notes.push(n);
  const byId = (id) => notesState.notes.find((n) => n.id === id);

  const { Story } = defineMeta({
    title: 'Sessions/NoteBlocks',
    component: NoteBlocks,
    tags: ['autodocs'],
    argTypes: { compact: { control: 'boolean' } },
    args: { compact: false, onopeneasel: fn() },
  });
</script>

<Story name="Mixed blocks roomy">
  {#snippet template(args)}<div class="w-[32rem]">
      <NoteBlocks {...args} note={byId('sb-nb-mixed')} />
    </div>{/snippet}
</Story>

<Story name="Mixed blocks compact" args={{ compact: true }}>
  {#snippet template(args)}<div class="w-80">
      <NoteBlocks {...args} note={byId('sb-nb-mixed')} />
    </div>{/snippet}
</Story>

<Story name="Single text block">
  {#snippet template(args)}<div class="w-[32rem]">
      <NoteBlocks {...args} note={byId('sb-nb-text')} />
    </div>{/snippet}
</Story>

<Story name="No blocks">
  {#snippet template(args)}<div class="w-[32rem]">
      <NoteBlocks {...args} note={byId('sb-nb-empty')} />
    </div>{/snippet}
</Story>
