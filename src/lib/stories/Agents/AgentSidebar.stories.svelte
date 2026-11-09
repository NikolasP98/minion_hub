<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
  import AgentSidebar from '$lib/components/agents/AgentSidebar.svelte';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';

  // Sidebar reads the gateway/connection stores (no data props); each story seeds them.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const agents = [
    { id: 'panik', identity: { name: 'Panik' }, status: 'running' },
    { id: 'faces-clinic', identity: { name: 'Faces Clinic' }, emoji: '🦷', status: 'idle' },
    { id: 'reminders', identity: { name: 'Reminders' }, status: 'thinking' },
    {
      id: 'bookkeeper',
      identity: { name: 'Bookkeeper with a very long display name' },
      status: 'idle',
    },
  ];
  const seed = (patch) => async () => {
    Object.assign(conn, { connected: false, connecting: false });
    gw.agents = [];
    ui.selectedAgentId = null;
    patch?.();
  };
  const connected = () => {
    conn.connected = true;
    gw.agents = agents;
    ui.selectedAgentId = 'panik';
  };

  const { Story } = defineMeta({
    title: 'Agents/AgentSidebar',
    component: AgentSidebar,
    tags: ['autodocs'],
    parameters: {
      sveltekit_experimental: {
        state: { page: { url: new URL('http://localhost/agents'), data: {} } },
      },
    },
    argTypes: { collapseLevel: { control: 'select', options: ['expanded', 'mini', 'collapsed'] } },
    args: { collapseLevel: 'expanded' },
  });
</script>

<Story name="Not connected" play={seed()}>
  {#snippet template(args)}
    <div class="w-64 h-[32rem]">
      <QueryClientProvider client={queryClient}><AgentSidebar {...args} /></QueryClientProvider>
    </div>
  {/snippet}
</Story>

<Story name="Connecting" play={seed(() => (conn.connecting = true))}>
  {#snippet template(args)}
    <div class="w-64 h-[32rem]">
      <QueryClientProvider client={queryClient}><AgentSidebar {...args} /></QueryClientProvider>
    </div>
  {/snippet}
</Story>

<Story name="Connected with agents" play={seed(connected)}>
  {#snippet template(args)}
    <div class="w-64 h-[32rem]">
      <QueryClientProvider client={queryClient}><AgentSidebar {...args} /></QueryClientProvider>
    </div>
  {/snippet}
</Story>

<Story name="Connected no agents" play={seed(() => (conn.connected = true))}>
  {#snippet template(args)}
    <div class="w-64 h-[32rem]">
      <QueryClientProvider client={queryClient}><AgentSidebar {...args} /></QueryClientProvider>
    </div>
  {/snippet}
</Story>

<Story name="Mini" args={{ collapseLevel: 'mini' }} play={seed(connected)}>
  {#snippet template(args)}
    <div class="w-14 h-[32rem]">
      <QueryClientProvider client={queryClient}><AgentSidebar {...args} /></QueryClientProvider>
    </div>
  {/snippet}
</Story>
