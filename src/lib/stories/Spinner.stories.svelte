<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Spinner from '$lib/components/ui/Spinner.svelte';

  const { Story } = defineMeta({
    title: 'Atoms/Feedback/Spinner',
    component: Spinner,
    tags: ['autodocs'],
    argTypes: {
      size: { control: 'select', options: ['xs', 'sm', 'md', 'lg'] },
      label: { control: 'text' },
    },
    args: { size: 'md', label: 'Loading' },
  });

  const sizes = ['xs', 'sm', 'md', 'lg'] as const;
</script>

<Story name="Default">
  {#snippet template(args)}
    <Spinner {...args} />
  {/snippet}
</Story>

<Story name="Sizes">
  {#snippet template()}
    <div class="flex items-center gap-4">
      {#each sizes as s (s)}<Spinner size={s} label="Loading" />{/each}
    </div>
  {/snippet}
</Story>
