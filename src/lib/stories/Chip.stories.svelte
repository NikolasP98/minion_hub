<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Chip from '$lib/components/ui/Chip.svelte';

  const { Story } = defineMeta({
    title: 'Hub/Chip',
    component: Chip,
    tags: ['autodocs'],
    argTypes: {
      status: { control: 'select', options: [undefined, 'success', 'warning', 'danger', 'info'] },
      count: { control: 'number' },
    },
    args: {},
  });
</script>

<Story name="Default">
  {#snippet template(args)}
    <Chip {...args}>Default</Chip>
  {/snippet}
</Story>

<Story name="With count" args={{ count: 12 }}>
  {#snippet template(args)}
    <Chip {...args}>Open</Chip>
  {/snippet}
</Story>

<Story name="Removable" args={{ onRemove: () => {} }}>
  {#snippet template(args)}
    <Chip {...args}>Removable</Chip>
  {/snippet}
</Story>

<Story name="Status">
  {#snippet template()}
    <div class="flex gap-2">
      {#each ['success', 'warning', 'danger', 'info'] as s (s)}<Chip status={s}>{s}</Chip>{/each}
    </div>
  {/snippet}
</Story>
