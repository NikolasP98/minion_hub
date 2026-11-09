<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import SessionsList from '$lib/components/sessions/SessionsList.svelte';

  const now = Date.now();
  const agents = ['panik', 'faces-clinic', 'reminders'];
  const statuses = ['running', 'thinking', 'idle', 'aborted', 'done'];
  const row = (i, agentId = agents[i % agents.length]) => ({
    id: `s${i}`,
    serverId: 'srv-1',
    agentId,
    sessionKey: i === 0 ? `agent:${agentId}:main` : `agent:${agentId}:whatsapp:dm:+5199${String(1000000 + i).slice(-7)}`,
    status: statuses[i % statuses.length],
    metadata: i % 3 === 0 ? JSON.stringify({ displayName: ['Ana Torres', 'Luis Paredes', 'Nightly stock check', 'Walk-in with a very long customer name that overflows'][i % 4] }) : null,
    createdAt: now - i * 3_600_000,
    updatedAt: now - i * 11 * 60_000,
  });
  const five = Array.from({ length: 5 }, (_, i) => row(i, 'panik'));
  const fifty = Array.from({ length: 50 }, (_, i) => row(i));

  const { Story } = defineMeta({
    title: 'Sessions/SessionsList',
    component: SessionsList,
    tags: ['autodocs'],
    args: { sessions: five, selectedKey: null, onSelect: fn() },
  });
</script>

<Story name="Zero sessions" args={{ sessions: [] }}>
  {#snippet template(args)}<div class="w-80 h-96"><SessionsList {...args} /></div>{/snippet}
</Story>

<Story name="Five sessions one agent">
  {#snippet template(args)}<div class="w-80 h-96"><SessionsList {...args} /></div>{/snippet}
</Story>

<Story name="Selected" args={{ selectedKey: five[1].sessionKey }}>
  {#snippet template(args)}<div class="w-80 h-96"><SessionsList {...args} /></div>{/snippet}
</Story>

<Story name="Fifty sessions three agents" args={{ sessions: fifty, selectedKey: fifty[7].sessionKey }}>
  {#snippet template(args)}<div class="w-80 h-96"><SessionsList {...args} /></div>{/snippet}
</Story>
