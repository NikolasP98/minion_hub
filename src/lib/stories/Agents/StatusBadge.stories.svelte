<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import type { ComponentProps } from 'svelte';
  import StatusBadge from '$lib/components/agents/StatusBadge.svelte';

  const statuses: ComponentProps<typeof StatusBadge>['status'][] = [
    'running',
    'thinking',
    'idle',
    'error',
    'paused',
  ];
  const sizes: NonNullable<ComponentProps<typeof StatusBadge>['size']>[] = ['sm', 'md', 'lg'];

  const { Story } = defineMeta({
    title: 'Components/Agents/StatusBadge',
    component: StatusBadge,
    tags: ['autodocs'],
    argTypes: {
      status: { control: 'select', options: statuses },
      size: { control: 'select', options: sizes },
    },
    args: { status: 'running', size: 'md' },
  });
</script>

<Story name="Running" />
<Story name="Thinking" args={{ status: 'thinking' }} />
<Story name="Idle" args={{ status: 'idle' }} />
<Story name="Error" args={{ status: 'error' }} />
<Story name="Paused" args={{ status: 'paused' }} />

<Story name="All statuses and sizes">
  {#snippet template()}
    <div class="flex flex-col gap-3">
      {#each statuses as status (status)}
        <div class="flex items-center gap-4">
          <span class="w-16 text-xs text-muted">{status}</span>
          {#each sizes as size (size)}<StatusBadge {status} {size} />{/each}
        </div>
      {/each}
    </div>
  {/snippet}
</Story>
