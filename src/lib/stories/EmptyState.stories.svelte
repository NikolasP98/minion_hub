<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';
  import { Button } from '@minion-stack/ui';
  import { Inbox } from 'lucide-svelte';

  const { Story } = defineMeta({
    title: 'Hub/EmptyState',
    component: EmptyState,
    tags: ['autodocs'],
    argTypes: {
      tone: { control: 'select', options: ['neutral', 'error'] },
      compact: { control: 'boolean' },
    },
    args: {
      title: 'No items yet',
      description: 'Create your first item to get started.',
      icon: Inbox,
      tone: 'neutral',
      compact: false,
    },
  });
</script>

<Story name="Default">
  {#snippet template(args)}
    <EmptyState {...args} />
  {/snippet}
</Story>

<Story name="With action">
  {#snippet template(args)}
    <EmptyState {...args}>
      {#snippet action()}<Button variant="primary">New item</Button>{/snippet}
    </EmptyState>
  {/snippet}
</Story>

<Story
  name="Error"
  args={{ title: 'Something went wrong', description: 'Retry or contact support.', tone: 'error' }}
>
  {#snippet template(args)}
    <EmptyState {...args}>
      {#snippet action()}<Button variant="secondary">Retry</Button>{/snippet}
    </EmptyState>
  {/snippet}
</Story>

<Story name="Compact" args={{ compact: true, icon: undefined }}>
  {#snippet template(args)}
    <EmptyState {...args} />
  {/snippet}
</Story>
