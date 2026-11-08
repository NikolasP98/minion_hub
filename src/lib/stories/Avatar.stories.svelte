<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import Avatar from '$lib/components/ui/Avatar.svelte';

  const { Story } = defineMeta({
    title: 'Hub/Avatar',
    component: Avatar,
    tags: ['autodocs'],
    argTypes: { size: { control: 'select', options: ['xs', 'sm', 'md', 'lg', 'touch'] } },
    args: { name: 'Tenancy Owner', size: 'md' }
  });
</script>

<Story name="Initials">
  {#snippet template(args)}
    <Avatar {...args} />
  {/snippet}
</Story>

<Story name="Image" args={{ name: 'Minion', src: '/mascot.png' }}>
  {#snippet template(args)}
    <Avatar {...args} />
  {/snippet}
</Story>

<Story name="Broken image falls back" args={{ src: '/nope.png' }}>
  {#snippet template(args)}
    <Avatar {...args} />
  {/snippet}
</Story>

<Story name="Sizes">
  {#snippet template()}
    <div class="flex items-center gap-3">
      {#each ['xs', 'sm', 'md', 'lg', 'touch'] as s (s)}<Avatar name="Tenancy Owner" size={s} />{/each}
    </div>
  {/snippet}
</Story>
