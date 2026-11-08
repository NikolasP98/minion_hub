<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { IconButton } from '@minion-stack/ui';
  import { Plus } from 'lucide-svelte';

  const { Story } = defineMeta({
    title: 'Shared/IconButton',
    component: IconButton,
    tags: ['autodocs'],
    argTypes: {
      variant: { control: 'select', options: ['primary', 'secondary', 'ghost', 'danger'] },
      size: { control: 'select', options: ['sm', 'md', 'lg'] },
      loading: { control: 'boolean' },
      disabled: { control: 'boolean' }
    },
    args: { label: 'Add item', variant: 'secondary', size: 'md', loading: false, disabled: false }
  });
</script>

<Story name="Default">
  {#snippet template(args)}
    <IconButton {...args}>{#snippet icon()}<Plus size={16} />{/snippet}</IconButton>
  {/snippet}
</Story>

<Story name="Variants">
  {#snippet template()}
    <div class="flex gap-2">
      {#each ['primary', 'secondary', 'ghost', 'danger'] as v (v)}
        <IconButton label={v} variant={v}>{#snippet icon()}<Plus size={16} />{/snippet}</IconButton>
      {/each}
    </div>
  {/snippet}
</Story>

<Story name="Loading" args={{ loading: true }}>
  {#snippet template(args)}
    <IconButton {...args}>{#snippet icon()}<Plus size={16} />{/snippet}</IconButton>
  {/snippet}
</Story>

<Story name="Disabled" args={{ disabled: true }}>
  {#snippet template(args)}
    <IconButton {...args}>{#snippet icon()}<Plus size={16} />{/snippet}</IconButton>
  {/snippet}
</Story>
