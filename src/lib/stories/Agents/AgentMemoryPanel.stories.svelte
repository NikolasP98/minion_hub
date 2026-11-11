<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import AgentMemoryPanel from '$lib/components/agents/AgentMemoryPanel.svelte';

  // The panel fetches /api/agent-memories and the KG snapshot itself (no props for data),
  // so the only reachable state here is the error/empty one.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  const { Story } = defineMeta({
    title: 'Components/Agents/AgentMemoryPanel',
    component: AgentMemoryPanel,
    tags: ['autodocs'],
    args: { agentId: 'panik' },
  });
</script>

<Story name="No API available">
  {#snippet template(args)}
    <div class="w-[40rem] h-[32rem]">
      <QueryClientProvider client={queryClient}><AgentMemoryPanel {...args} /></QueryClientProvider>
    </div>
  {/snippet}
</Story>
