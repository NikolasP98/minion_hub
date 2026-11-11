<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Skeleton from '$lib/components/ui/Skeleton.svelte';

  const { Story } = defineMeta({
    title: 'Atoms/Feedback/Skeleton',
    component: Skeleton,
    tags: ['autodocs'],
    argTypes: {
      width: { control: 'text' },
      height: { control: 'text' },
      rounded: { control: 'text' },
    },
    args: { width: '240px', height: '12px', rounded: 'rounded' },
  });
</script>

<Story name="Line">
  {#snippet template(args)}
    <Skeleton {...args} />
  {/snippet}
</Story>

<Story name="Circle" args={{ width: '40px', height: '40px', rounded: 'rounded-full' }}>
  {#snippet template(args)}
    <Skeleton {...args} />
  {/snippet}
</Story>

<Story name="Card placeholder">
  {#snippet template()}
    <div class="flex w-64 flex-col gap-2">
      <Skeleton height="120px" rounded="rounded-md" />
      <Skeleton width="70%" />
      <Skeleton width="40%" />
    </div>
  {/snippet}
</Story>
