<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AiToolStatusRing from '$lib/components/ai/AiToolStatusRing.svelte';

  const STATUSES = ['idle', 'pending', 'running', 'success', 'error'];

  const { Story } = defineMeta({
    title: 'AI/AiToolStatusRing',
    component: AiToolStatusRing,
    tags: ['autodocs'],
    argTypes: {
      status: { control: 'select', options: STATUSES },
      size: { control: { type: 'range', min: 8, max: 64, step: 2 } },
    },
    args: { status: 'running', size: 16 },
  });
</script>

<Story name="Idle" args={{ status: 'idle' }} />
<Story name="Pending breathes" args={{ status: 'pending' }} />
<Story name="Running spins" args={{ status: 'running' }} />
<Story name="Success check" args={{ status: 'success' }} />
<Story name="Error cross" args={{ status: 'error' }} />

<Story name="All statuses">
  {#snippet template(args)}
    <div class="flex items-center gap-6">
      {#each STATUSES as status (status)}
        <div class="flex flex-col items-center gap-2">
          <AiToolStatusRing {...args} {status} />
          <span class="t-caption text-muted-foreground">{status}</span>
        </div>
      {/each}
    </div>
  {/snippet}
</Story>

<Story name="Sizes 12 to 48">
  {#snippet template(args)}
    <div class="flex items-end gap-4">
      {#each [12, 16, 20, 24, 32, 48] as size (size)}
        <AiToolStatusRing {...args} {size} />
      {/each}
    </div>
  {/snippet}
</Story>
