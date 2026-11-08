<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Textarea } from '@minion-stack/ui';

  const { Story } = defineMeta({
    title: 'Shared/Textarea',
    component: Textarea,
    tags: ['autodocs'],
    argTypes: {
      size: { control: 'select', options: ['sm', 'md', 'lg'] },
      resize: { control: 'select', options: ['none', 'vertical', 'both'] },
      rows: { control: 'number' },
      disabled: { control: 'boolean' },
      error: { control: 'text' },
      helper: { control: 'text' }
    },
    args: { label: 'Notes', placeholder: 'Anything to add?', rows: 3, size: 'md', disabled: false }
  });
</script>

<Story name="Default">
  {#snippet template(args)}
    <Textarea {...args} />
  {/snippet}
</Story>

<Story name="Helper" args={{ helper: 'Visible to staff only' }}>
  {#snippet template(args)}
    <Textarea {...args} />
  {/snippet}
</Story>

<Story name="Error" args={{ error: 'Too long' }}>
  {#snippet template(args)}
    <Textarea {...args} />
  {/snippet}
</Story>

<Story name="Disabled" args={{ disabled: true, value: 'Read only' }}>
  {#snippet template(args)}
    <Textarea {...args} />
  {/snippet}
</Story>
