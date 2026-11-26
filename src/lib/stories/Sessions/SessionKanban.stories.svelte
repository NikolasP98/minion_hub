<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { userEvent } from 'storybook/test';
  import SessionKanban from '$lib/components/sessions/SessionKanban.svelte';
  import {
    sessionTasksState,
    type SessionTaskData,
  } from '$lib/state/features/session-tasks.svelte';

  const task = (
    id: string,
    title: string,
    status: SessionTaskData['status'],
    description: string | null = null,
  ): SessionTaskData => ({
    id,
    tenantId: 'story',
    serverId: 'story',
    sessionKey: 'story-session',
    title,
    description,
    status,
    sortOrder: 0,
    metadata: null,
    createdAt: 0,
    updatedAt: 0,
  });

  // The board reads the shared session-task state; with no server id it never fetches,
  // so a move in the story only updates this in-memory list.
  sessionTasksState.tasksBySession['story-session'] = [
    task('1', 'Review reminder templates', 'backlog', 'Three still use last year’s wording'),
    task('2', 'Confirm Monday bookings', 'todo', 'Twelve patients have not answered'),
    task('3', 'Send the price list', 'todo'),
    task('4', 'Reschedule Carla Ruiz', 'in_progress', 'Asked to move to Thursday'),
    task('5', 'Answer the Botox question', 'done'),
    task('6', 'Register Ana Díaz’s payment', 'done', 'S/ 350 by Yape'),
  ];
  sessionTasksState.tasksBySession['story-empty'] = [];

  /** The panel remembers "collapsed" by default; open it for the story. */
  const expand = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
    const header = canvasElement.querySelector<HTMLElement>(
      '[aria-controls="session-kanban-panel"]',
    );
    if (header && header.getAttribute('aria-expanded') !== 'true') await userEvent.click(header);
  };

  const { Story } = defineMeta({
    title: 'Components/Sessions/SessionKanban',
    component: SessionKanban,
    tags: ['autodocs'],
    args: { sessionKey: 'story-session', serverId: null },
  });
</script>

<Story name="Board" play={expand} />
<Story name="Collapsed" />
<Story name="No tasks" args={{ sessionKey: 'story-empty' }} play={expand} />
