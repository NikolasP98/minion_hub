<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import TaskCard, { type KanbanTask } from '$lib/components/tasks/TaskCard.svelte';

  const statuses: KanbanTask['status'][] = ['backlog', 'todo', 'in_progress', 'done'];

  const { Story } = defineMeta({
    title: 'Components/Cards/TaskCard',
    component: TaskCard,
    tags: ['autodocs'],
    args: {
      task: {
        id: 't1',
        title: 'Reconcile Friday shift',
        description: 'Cash drawer was 12.50 short',
        status: 'todo',
      },
    },
  });
</script>

<Story name="Todo">
  {#snippet template(args)}<div class="w-64"><TaskCard {...args} /></div>{/snippet}
</Story>

<Story name="All statuses">
  {#snippet template(args)}
    <div class="w-64">
      {#each statuses as status (status)}
        <TaskCard task={{ ...args.task, id: status, status }} />
      {/each}
    </div>
  {/snippet}
</Story>

<Story
  name="No description"
  args={{ task: { id: 't2', title: 'Order gloves', description: null, status: 'backlog' } }}
>
  {#snippet template(args)}<div class="w-64"><TaskCard {...args} /></div>{/snippet}
</Story>

<Story
  name="Long title"
  args={{
    task: {
      id: 't3',
      title:
        'Call every patient booked for next Tuesday to confirm the new address and the parking instructions',
      description:
        'Includes the three walk-ins from last week who left no email; use the WhatsApp template if the number is mobile',
      status: 'in_progress',
    },
  }}
>
  {#snippet template(args)}<div class="w-64"><TaskCard {...args} /></div>{/snippet}
</Story>
