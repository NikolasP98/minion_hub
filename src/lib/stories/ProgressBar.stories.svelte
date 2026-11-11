<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import ProgressBar from '$lib/components/ui/ProgressBar.svelte';

  const { Story } = defineMeta({
    title: 'Atoms/Feedback/ProgressBar',
    component: ProgressBar,
    tags: ['autodocs'],
    argTypes: {
      value: { control: { type: 'range', min: 0, max: 100 } },
      size: { control: 'select', options: ['xs', 'sm', 'md'] },
      label: { control: 'text' },
      detail: { control: 'text' },
    },
    args: { value: 60, max: 100, label: 'Syncing', detail: '60%', size: 'md' },
  });
</script>

<Story name="Default">
  {#snippet template(args)}
    <ProgressBar {...args} />
  {/snippet}
</Story>

<Story name="Small" args={{ value: 25, label: '25 of 100', detail: '', size: 'sm' }}>
  {#snippet template(args)}
    <ProgressBar {...args} />
  {/snippet}
</Story>

<Story name="Complete" args={{ value: 100, label: 'Complete', detail: '100%' }}>
  {#snippet template(args)}
    <ProgressBar {...args} />
  {/snippet}
</Story>

<Story name="Indeterminate" args={{ value: null, label: 'Working', detail: '' }}>
  {#snippet template(args)}
    <ProgressBar {...args} />
  {/snippet}
</Story>
