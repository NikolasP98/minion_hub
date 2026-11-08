<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AgentFiles from '$lib/components/agents/AgentFiles.svelte';

  // The tree is fetched through the gateway WebSocket on mount (no props for data),
  // so the only reachable state here is the "not connected" error.
  const { Story } = defineMeta({
    title: 'Agents/AgentFiles',
    component: AgentFiles,
    tags: ['autodocs'],
    args: { agentId: 'panik' },
  });
</script>

<Story name="No gateway">
  {#snippet template(args)}<div class="w-[40rem] h-96"><AgentFiles {...args} /></div>{/snippet}
</Story>
