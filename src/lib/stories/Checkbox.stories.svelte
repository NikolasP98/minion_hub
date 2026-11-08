<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Checkbox } from '@minion-stack/ui';

  const { Story } = defineMeta({
    title: 'Shared/Checkbox',
    component: Checkbox,
    tags: ['autodocs'],
    argTypes: {
      checked: { control: 'boolean' },
      indeterminate: { control: 'boolean' },
      disabled: { control: 'boolean' },
      error: { control: 'text' },
      helper: { control: 'text' }
    },
    args: { label: 'Send receipt', checked: false, indeterminate: false, disabled: false }
  });
</script>

<Story name="Default">
  {#snippet template(args)}
    <Checkbox {...args} />
  {/snippet}
</Story>

<Story name="Checked" args={{ checked: true }}>
  {#snippet template(args)}
    <Checkbox {...args} />
  {/snippet}
</Story>

<Story name="Indeterminate" args={{ indeterminate: true, helper: 'Some rows selected' }}>
  {#snippet template(args)}
    <Checkbox {...args} />
  {/snippet}
</Story>

<Story name="Error" args={{ error: 'You must accept' }}>
  {#snippet template(args)}
    <Checkbox {...args} />
  {/snippet}
</Story>

<Story name="Disabled" args={{ disabled: true, checked: true }}>
  {#snippet template(args)}
    <Checkbox {...args} />
  {/snippet}
</Story>
