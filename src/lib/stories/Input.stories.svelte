<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Input } from '@minion-stack/ui';

  const { Story } = defineMeta({
    title: 'Shared/Input',
    component: Input,
    tags: ['autodocs'],
    argTypes: {
      size: { control: 'select', options: ['sm', 'md', 'lg', 'touch'] },
      type: { control: 'select', options: ['text', 'email', 'password', 'number', 'search'] },
      disabled: { control: 'boolean' },
      required: { control: 'boolean' },
      error: { control: 'text' },
      helper: { control: 'text' }
    },
    args: { label: 'Name', placeholder: 'Jane Doe', size: 'md', disabled: false, required: false }
  });
</script>

<Story name="Default">
  {#snippet template(args)}
    <Input {...args} />
  {/snippet}
</Story>

<Story name="Helper" args={{ helper: 'Shown on the receipt' }}>
  {#snippet template(args)}
    <Input {...args} />
  {/snippet}
</Story>

<Story name="Error" args={{ error: 'Required', value: '' }}>
  {#snippet template(args)}
    <Input {...args} />
  {/snippet}
</Story>

<Story name="Disabled" args={{ disabled: true, value: 'Locked' }}>
  {#snippet template(args)}
    <Input {...args} />
  {/snippet}
</Story>

<Story name="Sizes">
  {#snippet template()}
    <div class="flex flex-col gap-3">
      {#each ['sm', 'md', 'lg', 'touch'] as s (s)}<Input label={s} size={s} placeholder={s} />{/each}
    </div>
  {/snippet}
</Story>
