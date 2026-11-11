<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Chip from '$lib/components/ui/Chip.svelte';

  const { Story } = defineMeta({
    title: 'Atoms/Display/Chip',
    component: Chip,
    tags: ['autodocs'],
    argTypes: {
      status: { control: 'select', options: [undefined, 'success', 'warning', 'danger', 'info'] },
      count: { control: 'number' },
    },
    args: {},
  });

  const statuses = ['success', 'warning', 'danger', 'info'] as const;
</script>

<Story name="Default">
  {#snippet template({ children: _children, ...args })}
    <Chip {...args}>Default</Chip>
  {/snippet}
</Story>

<Story name="With count" args={{ count: 12 }}>
  {#snippet template({ children: _children, ...args })}
    <Chip {...args}>Open</Chip>
  {/snippet}
</Story>

<Story name="Removable" args={{ onRemove: () => {} }}>
  {#snippet template({ children: _children, ...args })}
    <Chip {...args}>Removable</Chip>
  {/snippet}
</Story>

<Story name="Status">
  {#snippet template()}
    <div class="flex gap-2">
      {#each statuses as s (s)}<Chip status={s}>{s}</Chip>{/each}
    </div>
  {/snippet}
</Story>
