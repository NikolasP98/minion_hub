<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import KanbanCol from '$lib/components/tasks/KanbanCol.svelte';
  import type { KanbanTask } from '$lib/components/tasks/TaskCard.svelte';

  const titles = [
    'Reconcile Friday shift',
    'Order nitrile gloves (M, L)',
    'Reply to supplier quote',
    'Update price list for March',
    'Archive 2024 invoices',
    'Fix printer in room 2',
    'Confirm Tuesday bookings',
    'Restock lidocaine',
    'Renew domain',
    'Train new receptionist on POS',
    'Review refund policy wording',
    'Send birthday messages',
  ];
  const task = (i: number, status: KanbanTask['status']): KanbanTask => ({
    id: `t${i}`,
    title: titles[i % titles.length],
    description: i % 3 === 0 ? null : `Detail line ${i + 1} with a bit more context`,
    status,
  });
  const many = (status: KanbanTask['status'], n: number) =>
    Array.from({ length: n }, (_, i) => task(i, status));

  const { Story } = defineMeta({
    title: 'Components/Cards/KanbanCol',
    component: KanbanCol,
    tags: ['autodocs'],
    argTypes: {
      status: { control: 'select', options: ['backlog', 'todo', 'in_progress', 'done'] },
    },
    args: { status: 'todo', label: 'To do', onDropTask: fn() },
  });
</script>

<Story name="Empty" args={{ tasks: [] }}>
  {#snippet template(args)}<div class="w-64 border border-border">
      <KanbanCol {...args} />
    </div>{/snippet}
</Story>

<Story name="One card" args={{ tasks: many('todo', 1) }}>
  {#snippet template(args)}<div class="w-64 border border-border">
      <KanbanCol {...args} />
    </div>{/snippet}
</Story>

<Story name="Twelve cards (scrolls)" args={{ tasks: many('todo', 12) }}>
  {#snippet template(args)}<div class="w-64 border border-border">
      <KanbanCol {...args} />
    </div>{/snippet}
</Story>

<Story
  name="Long titles"
  args={{
    tasks: [
      {
        id: 'l1',
        title:
          'Call every patient booked for next Tuesday to confirm the new address and parking instructions',
        description:
          'Includes the three walk-ins from last week who left no email address at the desk',
        status: 'todo',
      },
      {
        id: 'l2',
        title: 'Supercalifragilisticexpialidocious-unbreakable-identifier-0001',
        description: null,
        status: 'todo',
      },
    ],
  }}
>
  {#snippet template(args)}<div class="w-64 border border-border">
      <KanbanCol {...args} />
    </div>{/snippet}
</Story>

<Story name="Board (four columns)">
  {#snippet template(args)}
    <div class="grid grid-cols-4 border border-border">
      <KanbanCol {...args} status="backlog" label="Backlog" tasks={many('backlog', 3)} />
      <KanbanCol {...args} status="todo" label="To do" tasks={many('todo', 5)} />
      <KanbanCol
        {...args}
        status="in_progress"
        label="In progress"
        tasks={many('in_progress', 2)}
      />
      <KanbanCol {...args} status="done" label="Done" tasks={[]} />
    </div>
  {/snippet}
</Story>
