<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import GlobalActivity from '$lib/components/layout/GlobalActivity.svelte';

  // Plain-object stand-in for the ActionRuntime getters the component reads.
  const record = (id, definitionId, status, over = {}) => ({
    id,
    definitionId,
    policy: 'read',
    visibility: 'background',
    status,
    startedAt: Date.now(),
    attempts: [],
    ...over,
  });
  const runtime = ({ jobs = [], attention = [], indicatorVisible = false } = {}) => ({
    indicatorVisible,
    backgroundJobs: jobs.length,
    attentionRequired: attention.length,
    jobs,
    attention,
    dismiss: fn(),
  });

  const { Story } = defineMeta({
    title: 'Cards/GlobalActivity',
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
        record(1, 'table.export', 'running', { progress: { completed: 40, total: 100 } }),
        record(2, 'finance.sync', 'running'),
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
      jobs: [record(1, 'table.export', 'running', { progress: { completed: 9, total: 12 } })],
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
        record(1, 'table.export', 'running', { progress: { completed: 40, total: 100 } }),
        record(2, 'finance.sync', 'running'),
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
      jobs: [record(1, 'table.export', 'running', { progress: { completed: 9, total: 12 } })],
      attention: [record(3, 'finance.emit', 'failed')],
    }),
  }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
>
  {#snippet template(args)}<GlobalActivity {...args} />{/snippet}
</Story>
