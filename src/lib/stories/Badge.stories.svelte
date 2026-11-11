<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { Badge } from '@minion-stack/ui';

  const { Story } = defineMeta({
    title: 'Atoms/Display/Badge',
    component: Badge,
    tags: ['autodocs'],
    argTypes: {
      variant: { control: 'select', options: ['semantic', 'status', 'neutral'] },
      value: {
        control: 'select',
        options: [
          'success',
          'error',
          'warning',
          'info',
          'accent',
          'brand',
          'running',
          'thinking',
          'idle',
          'aborted',
        ],
      },
      size: { control: 'select', options: ['sm', 'md'] },
      dot: { control: 'boolean' },
      pulse: { control: 'boolean' },
    },
    args: { variant: 'semantic', value: 'success', size: 'md', dot: false, pulse: false },
  });

  const semantic = ['success', 'error', 'warning', 'info', 'accent', 'brand'] as const;
  const status = ['running', 'thinking', 'idle', 'aborted'] as const;
</script>

<Story name="Default">
  {#snippet template(args)}
    <Badge {...args}>Active</Badge>
  {/snippet}
</Story>

<Story name="Semantic">
  {#snippet template()}
    <div class="flex flex-wrap gap-2">
      {#each semantic as v (v)}<Badge variant="semantic" value={v}>{v}</Badge>{/each}
      <Badge variant="neutral">neutral</Badge>
    </div>
  {/snippet}
</Story>

<Story name="Status">
  {#snippet template()}
    <div class="flex flex-wrap gap-2">
      {#each status as v (v)}<Badge variant="status" value={v} dot>{v}</Badge>{/each}
      <Badge variant="status" value="running" dot pulse>pulse</Badge>
    </div>
  {/snippet}
</Story>

<Story name="Small" args={{ size: 'sm', value: 'info' }}>
  {#snippet template(args)}
    <Badge {...args}>Small</Badge>
  {/snippet}
</Story>
