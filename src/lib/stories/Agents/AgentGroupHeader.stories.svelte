<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import AgentGroupHeader from '$lib/components/agents/AgentGroupHeader.svelte';

  const group = {
    id: 'g1',
    name: 'Clinic front desk',
    sortOrder: 0,
    memberAgentIds: ['panik', 'faces-clinic', 'reminders'],
  };

  const { Story } = defineMeta({
    title: 'Agents/AgentGroupHeader',
    component: AgentGroupHeader,
    tags: ['autodocs'],
    argTypes: { collapsed: { control: 'boolean' } },
    args: {
      group,
      collapsed: false,
      onToggle: fn(),
      onRename: fn(),
      onDelete: fn(),
      onDrop: fn(),
      onDragOver: fn(),
      onDragLeave: fn(),
    },
  });

  // Double-click the name to enter rename mode.
  const edit = async ({ canvas, userEvent }) => {
    await userEvent.dblClick(canvas.getByText(group.name));
  };
</script>

<Story name="Expanded">
  {#snippet template(args)}<div class="w-64 bg-bg2"><AgentGroupHeader {...args} /></div>{/snippet}
</Story>

<Story name="Collapsed" args={{ collapsed: true }}>
  {#snippet template(args)}<div class="w-64 bg-bg2"><AgentGroupHeader {...args} /></div>{/snippet}
</Story>

<Story name="Empty group" args={{ group: { ...group, name: 'Archive', memberAgentIds: [] } }}>
  {#snippet template(args)}<div class="w-64 bg-bg2"><AgentGroupHeader {...args} /></div>{/snippet}
</Story>

<Story
  name="Long name"
  args={{ group: { ...group, name: 'Everything that touches billing, SUNAT and the accountant' } }}
>
  {#snippet template(args)}<div class="w-64 bg-bg2"><AgentGroupHeader {...args} /></div>{/snippet}
</Story>

<Story name="Renaming" play={edit}>
  {#snippet template(args)}<div class="w-64 bg-bg2"><AgentGroupHeader {...args} /></div>{/snippet}
</Story>
