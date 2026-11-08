<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AgentHealthMetrics from '$lib/components/agents/AgentHealthMetrics.svelte';

  const { Story } = defineMeta({
    title: 'Agents/AgentHealthMetrics',
    component: AgentHealthMetrics,
    tags: ['autodocs'],
    args: { health: { state: 'active', lastRunAt: Date.now() - 12 * 60_000, runs30d: 412, successRate: 0.987 } },
  });
</script>

<Story name="Healthy" />
<Story name="Degraded" args={{ health: { state: 'attention', lastRunAt: Date.now() - 3 * 86_400_000, runs30d: 38, successRate: 0.62 } }} />
<Story name="Disabled" args={{ health: { state: 'disabled', lastRunAt: null, runs30d: 0, successRate: null } }} />
<Story name="No data" args={{ health: { state: 'active', lastRunAt: null, runs30d: null, successRate: null } }} />
<Story name="Large numbers" args={{ health: { state: 'active', lastRunAt: Date.now() - 4_000, runs30d: 1284032, successRate: 1 } }} />
