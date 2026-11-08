<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Tabs from '$lib/components/ui/Tabs.svelte';

  const tabs = [
    { value: 'overview', label: 'Overview' },
    { value: 'activity', label: 'Activity', count: 3 },
    { value: 'settings', label: 'Settings' },
    { value: 'billing', label: 'Billing', disabled: true }
  ];

  const { Story } = defineMeta({
    title: 'Hub/Tabs',
    component: Tabs,
    tags: ['autodocs'],
    argTypes: {
      size: { control: 'select', options: ['sm', 'md'] },
      fitted: { control: 'boolean' },
      value: { control: 'select', options: tabs.map((t) => t.value) }
    },
    args: { tabs, value: 'overview', size: 'md', fitted: false, id: 'sb-tabs', 'aria-label': 'Sections' }
  });
</script>

<Story name="Default">
  {#snippet template(args)}
    <Tabs {...args} />
  {/snippet}
</Story>

<Story name="Small" args={{ size: 'sm', value: 'activity' }}>
  {#snippet template(args)}
    <Tabs {...args} />
  {/snippet}
</Story>

<Story name="Fitted" args={{ fitted: true, value: 'settings' }}>
  {#snippet template(args)}
    <Tabs {...args} />
  {/snippet}
</Story>
