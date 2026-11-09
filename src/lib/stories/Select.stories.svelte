<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Select } from '@minion-stack/ui';

  const options = [
    { value: 'a', label: 'Option A' },
    { value: 'b', label: 'Option B' },
    { value: 'c', label: 'Option C', disabled: true },
  ];

  const { Story } = defineMeta({
    title: 'Shared/Select',
    component: Select,
    tags: ['autodocs'],
    argTypes: {
      size: { control: 'select', options: ['sm', 'md', 'lg', 'touch'] },
      disabled: { control: 'boolean' },
      error: { control: 'text' },
      helper: { control: 'text' },
    },
    args: { label: 'Choose', options, value: 'a', size: 'md', disabled: false },
  });
</script>

<Story name="Default">
  {#snippet template(args)}
    <Select {...args} />
  {/snippet}
</Story>

<Story name="Placeholder" args={{ value: undefined, placeholder: 'Pick one' }}>
  {#snippet template(args)}
    <Select {...args} />
  {/snippet}
</Story>

<Story name="Error" args={{ value: undefined, error: 'Pick one' }}>
  {#snippet template(args)}
    <Select {...args} />
  {/snippet}
</Story>

<Story name="Disabled" args={{ value: 'b', disabled: true }}>
  {#snippet template(args)}
    <Select {...args} />
  {/snippet}
</Story>
