<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import StatusDot from '$lib/components/ui/StatusDot.svelte';

  const { Story } = defineMeta({
    title: 'Atoms/Feedback/StatusDot',
    component: StatusDot,
    tags: ['autodocs'],
    argTypes: {
      status: { control: 'select', options: [undefined, 'running', 'thinking', 'idle', 'aborted'] },
      state: { control: 'select', options: [undefined, 'active', 'attention', 'disabled'] },
      size: { control: 'select', options: ['sm', 'md', 'lg'] },
      expanded: { control: 'boolean' },
    },
    args: { status: 'running', size: 'md' },
  });

  const statuses = ['running', 'thinking', 'idle', 'aborted'] as const;
</script>

<Story name="Dot">
  {#snippet template(args)}
    <StatusDot {...args} />
  {/snippet}
</Story>

<Story name="All dots">
  {#snippet template()}
    <div class="flex items-center gap-4">
      {#each statuses as s (s)}<StatusDot status={s} size="lg" />{/each}
    </div>
  {/snippet}
</Story>

<Story
  name="Labeled chip"
  args={{ status: undefined, state: 'active', label: 'Online', expanded: true }}
>
  {#snippet template(args)}
    <StatusDot {...args} />
  {/snippet}
</Story>

<Story
  name="Chip reveals on hover"
  args={{ status: undefined, state: 'attention', label: 'Needs review', expanded: false }}
>
  {#snippet template(args)}
    <StatusDot {...args} />
  {/snippet}
</Story>
