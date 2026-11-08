<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import ViewSwitcher from '$lib/components/agents/ViewSwitcher.svelte';

  const { Story } = defineMeta({
    title: 'Agents/ViewSwitcher',
    component: ViewSwitcher,
    tags: ['autodocs'],
    argTypes: { active: { control: 'select', options: ['list', 'tree', 'timeline'] } },
    args: { active: 'list', onchange: fn() },
  });
</script>

<Story name="List active" />
<Story name="Tree active" args={{ active: 'tree' }} />
<Story name="Timeline active" args={{ active: 'timeline' }} />
