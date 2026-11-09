<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SubagentMeta from '$lib/components/agents/SubagentMeta.svelte';
  import { running, unknown, failed } from './subagent-fixtures';

  const { Story } = defineMeta({
    title: 'Agents/SubagentMeta',
    component: SubagentMeta,
    tags: ['autodocs'],
    args: {
      session: {
        ...running,
        spawnedBy: 'agent:panik:main',
        sessionId: 'a1b2c3d4-0000-4000-8000-000000000001',
        displayName: 'Scan competitors',
      },
    },
  });
</script>

<Story name="Full session">
  {#snippet template(args)}<div class="w-96 bg-bg"><SubagentMeta {...args} /></div>{/snippet}
</Story>

<Story name="Failed session" args={{ session: failed }}>
  {#snippet template(args)}<div class="w-96 bg-bg"><SubagentMeta {...args} /></div>{/snippet}
</Story>

<Story name="Minimal session" args={{ session: unknown }}>
  {#snippet template(args)}<div class="w-96 bg-bg"><SubagentMeta {...args} /></div>{/snippet}
</Story>
