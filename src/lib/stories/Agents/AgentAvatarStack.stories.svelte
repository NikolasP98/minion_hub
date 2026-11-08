<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AgentAvatarStack from '$lib/components/prompt/AgentAvatarStack.svelte';

  const agents = [
    { agentId: 'panik', label: 'Panik', emoji: '🤖' },
    { agentId: 'faces-clinic', label: 'Faces Clinic' },
    { agentId: 'reminders', label: 'Reminders', emoji: '⏰' },
    { agentId: 'bookkeeper', label: 'Bookkeeper' },
    { agentId: 'triage', label: 'Triage kernel' },
    { agentId: 'writer', label: 'Writer' },
    { agentId: 'ops', label: 'Ops' },
    { agentId: 'research', label: 'Research' },
  ];

  const { Story } = defineMeta({
    title: 'Agents/AgentAvatarStack',
    component: AgentAvatarStack,
    tags: ['autodocs'],
    argTypes: { max: { control: 'number' }, size: { control: 'number' } },
    args: { agents: agents.slice(0, 3), max: 4, size: 18 },
  });
</script>

<Story name="Three agents" />
<Story name="One agent" args={{ agents: agents.slice(0, 1) }} />
<Story name="Overflow plus four" args={{ agents }} />
<Story name="Large chips" args={{ agents, size: 32, max: 5 }} />
<Story name="Empty" args={{ agents: [] }} />
