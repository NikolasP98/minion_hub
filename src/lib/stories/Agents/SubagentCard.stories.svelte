<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import SubagentCard from '$lib/components/agents/SubagentCard.svelte';
  import { running, completed, failed, unknown } from './subagent-fixtures';

  const { Story } = defineMeta({
    title: 'Agents/SubagentCard',
    component: SubagentCard,
    tags: ['autodocs'],
    argTypes: { selected: { control: 'boolean' } },
    args: { session: running, selected: false, onclick: fn() },
  });
</script>

<Story name="Running">
  {#snippet template(args)}<div class="w-72 bg-bg"><SubagentCard {...args} /></div>{/snippet}
</Story>

<Story name="Completed" args={{ session: completed }}>
  {#snippet template(args)}<div class="w-72 bg-bg"><SubagentCard {...args} /></div>{/snippet}
</Story>

<Story name="Failed with large token count" args={{ session: failed }}>
  {#snippet template(args)}<div class="w-72 bg-bg"><SubagentCard {...args} /></div>{/snippet}
</Story>

<Story name="Unknown status no label" args={{ session: unknown }}>
  {#snippet template(args)}<div class="w-72 bg-bg"><SubagentCard {...args} /></div>{/snippet}
</Story>

<Story name="Selected" args={{ selected: true }}>
  {#snippet template(args)}<div class="w-72 bg-bg"><SubagentCard {...args} /></div>{/snippet}
</Story>

<Story
  name="Long label"
  args={{
    session: {
      ...running,
      label:
        'researcher: Compare every dental supplier in Lima by price, delivery time and whether they issue electronic invoices',
    },
  }}
>
  {#snippet template(args)}<div class="w-72 bg-bg"><SubagentCard {...args} /></div>{/snippet}
</Story>
