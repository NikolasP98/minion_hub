<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import GlobalActivity from '$lib/components/layout/GlobalActivity.svelte';
  import type { ActionRecord, ActionRuntime } from '$lib/services/actions/runtime.svelte';

  // Plain-object stand-in for the ActionRuntime the component reads; mutating methods are inert.
  const record = (
    id: number,
    definitionId: string,
    status: ActionRecord['status'],
    over: Partial<ActionRecord> = {},
  ): ActionRecord => ({
    id,
    definitionId,
    policy: 'read',
    visibility: 'background',
    status,
    startedAt: Date.now(),
    attempts: [],
    ...over,
  });
  const unavailable = (): never => {
    throw new Error('Not available in the story runtime');
  };
  const runtime = ({
    jobs = [],
    attention = [],
    indicatorVisible = false,
  }: {
    jobs?: ActionRecord[];
    attention?: ActionRecord[];
    indicatorVisible?: boolean;
  } = {}): ActionRuntime => ({
    scopeVersion: 0,
    foregroundPending: 0,
    backgroundPending: jobs.length,
    indicatorVisible,
    backgroundJobs: jobs.length,
    attentionRequired: attention.length,
    jobs,
    attention,
    size: jobs.length + attention.length,
    get: () => undefined,
    start: unavailable,
    run: unavailable,
    runCommand: async () => unavailable(),
    dismiss: fn(),
    reconcile: fn(),
    subscribe: () => () => {},
    setScope: () => {},
    dispose: () => {},
  });

  const { Story } = defineMeta({
    title: 'Components/Cards/GlobalActivity',
    component: GlobalActivity,
    tags: ['autodocs'],
    argTypes: { connecting: { control: 'boolean' } },
    args: { connecting: false },
  });
</script>

<!-- The progress bar is fixed to the top edge and shown below 48rem only; the summary pill is fixed bottom-right. -->
<Story name="Idle (renders nothing)" args={{ actions: runtime() }}>
  {#snippet template(args)}<GlobalActivity {...args} />{/snippet}
</Story>

<Story name="Connecting" args={{ actions: runtime(), connecting: true }}>
  {#snippet template(args)}<GlobalActivity {...args} />{/snippet}
</Story>

<Story name="Indicator visible" args={{ actions: runtime({ indicatorVisible: true }) }}>
  {#snippet template(args)}<GlobalActivity {...args} />{/snippet}
</Story>

<Story
  name="Background jobs"
  args={{
    actions: runtime({
      jobs: [
        record(1, 'table.export', 'job-running', { progress: { completed: 40, total: 100 } }),
        record(2, 'finance.sync', 'job-running'),
      ],
    }),
  }}
>
  {#snippet template(args)}<GlobalActivity {...args} />{/snippet}
</Story>

<Story
  name="Attention required"
  args={{
    actions: runtime({
      attention: [
        record(3, 'table.bulk', 'failed'),
        record(4, 'finance.emit', 'conflict'),
        record(5, 'command.run', 'unknown'),
        record(6, 'table.import', 'committed-refreshing'),
        record(7, 'table.tags', 'partial'),
      ],
    }),
  }}
>
  {#snippet template(args)}<GlobalActivity {...args} />{/snippet}
</Story>

<Story
  name="Jobs and attention"
  args={{
    actions: runtime({
      indicatorVisible: true,
      jobs: [record(1, 'table.export', 'job-running', { progress: { completed: 9, total: 12 } })],
      attention: [record(3, 'finance.emit', 'failed')],
    }),
  }}
>
  {#snippet template(args)}<GlobalActivity {...args} />{/snippet}
</Story>

<!-- Responsive: the top progress bar only exists below 48rem, so these are the states where it is visible. -->
<Story
  name="Background jobs · Phone"
  args={{
    actions: runtime({
      jobs: [
        record(1, 'table.export', 'job-running', { progress: { completed: 40, total: 100 } }),
        record(2, 'finance.sync', 'job-running'),
      ],
    }),
  }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
>
  {#snippet template(args)}<GlobalActivity {...args} />{/snippet}
</Story>

<Story
  name="Jobs and attention · Phone"
  args={{
    actions: runtime({
      indicatorVisible: true,
      jobs: [record(1, 'table.export', 'job-running', { progress: { completed: 9, total: 12 } })],
      attention: [record(3, 'finance.emit', 'failed')],
    }),
  }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
>
  {#snippet template(args)}<GlobalActivity {...args} />{/snippet}
</Story>
