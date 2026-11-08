<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AutonomousAgentCard from '$lib/components/agents/AutonomousAgentCard.svelte';

  // Flat placeholder avatar (fixture content, not UI styling).
  const avatarUrl =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><circle cx="32" cy="32" r="32" fill="gray"/></svg>');

  const agent = {
    id: 'scheduling.reminders',
    source: 'system',
    name: 'Reminders',
    role: 'Appointment reminders',
    description: 'Sends a WhatsApp reminder 24 h before each booking and flags the ones that bounce.',
    avatarUrl,
    trigger: 'Every day at 08:00',
    managePath: '/scheduling/settings',
    status: { enabled: true, state: 'active', stats: { sent: 1284, failed: 3, skipped: 41 } },
  };

  const { Story } = defineMeta({
    title: 'Agents/AutonomousAgentCard',
    component: AutonomousAgentCard,
    tags: ['autodocs'],
    argTypes: { canAdd: { control: 'boolean' } },
    args: { agent, artifacts: [], canAdd: false },
  });
</script>

<Story name="Active">
  {#snippet template(args)}<div class="w-80"><AutonomousAgentCard {...args} /></div>{/snippet}
</Story>

<Story
  name="Attention"
  args={{ agent: { ...agent, status: { enabled: true, state: 'attention', detail: 'WhatsApp account disconnected since Monday', stats: { sent: 0, failed: 12, skipped: 0 } } } }}
>
  {#snippet template(args)}<div class="w-80"><AutonomousAgentCard {...args} /></div>{/snippet}
</Story>

<Story name="Disabled" args={{ agent: { ...agent, status: { enabled: false, state: 'disabled' } } }}>
  {#snippet template(args)}<div class="w-80"><AutonomousAgentCard {...args} /></div>{/snippet}
</Story>

<Story name="With flow menu gains View flow" args={{ agent: { ...agent, flowId: 'flow-reminders', source: 'workforce' } }}>
  {#snippet template(args)}<div class="w-80"><AutonomousAgentCard {...args} /></div>{/snippet}
</Story>

<Story name="No trigger large numbers" args={{ agent: { ...agent, trigger: null, status: { enabled: true, state: 'active', stats: { sent: 1284032, failed: 9931, skipped: 120455 } } } }}>
  {#snippet template(args)}<div class="w-80"><AutonomousAgentCard {...args} /></div>{/snippet}
</Story>

<Story
  name="Long description"
  args={{
    agent: {
      ...agent,
      name: 'Inventory replenishment and supplier follow-up',
      description:
        'Watches stock levels across both clinics every night, drafts purchase orders for anything under the reorder point, emails the supplier, and nags the owner on WhatsApp until the order is confirmed or cancelled.',
    },
  }}
>
  {#snippet template(args)}<div class="w-80"><AutonomousAgentCard {...args} /></div>{/snippet}
</Story>
