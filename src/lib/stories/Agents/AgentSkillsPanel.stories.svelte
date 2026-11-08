<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AgentSkillsPanel from '$lib/components/agents/AgentSkillsPanel.svelte';
  import { agentSkillsState } from '$lib/state/agents/agent-skills.svelte';

  const skill = (skillKey, name, description, extra = {}) => ({
    skillKey,
    name,
    description,
    source: 'bundled',
    bundled: true,
    eligible: true,
    disabled: false,
    blockedByAllowlist: false,
    agentEnabled: true,
    always: false,
    requirements: {},
    missing: {},
    install: [],
    ...extra,
  });
  const skills = [
    skill('scheduling', 'Scheduling', 'Book, move and cancel appointments from chat.', { emoji: '📅', always: true }),
    skill('pos', 'Point of sale', 'Charge a visit and print the receipt.', { emoji: '🧾' }),
    skill('reporting', 'Weekly report', 'Summarise revenue and no-shows every Monday.', { agentEnabled: false }),
    skill('whatsapp-templates', 'WhatsApp templates', 'Approved outbound templates for reminders and confirmations.', { bundled: false, source: 'workspace', homepage: 'https://example.com' }),
    skill('sunat', 'SUNAT invoicing', 'Issue electronic invoices and credit notes.', {
      agentEnabled: false,
      disabled: true,
      requirements: { bins: ['openssl'], env: ['SUNAT_SOL_USER', 'SUNAT_SOL_PASS'] },
      missing: { env: ['SUNAT_SOL_USER', 'SUNAT_SOL_PASS'] },
      install: [{ id: 'brew-openssl', kind: 'brew', label: 'brew install openssl', bins: ['openssl'] }],
    }),
  ];

  // The panel loads via the gateway on mount (which fails here); each story seeds the store afterwards.
  const seed = (patch) => async () => {
    Object.assign(agentSkillsState, { skills: [], agentFilter: null, loading: false, saving: false, error: null }, patch);
  };

  const { Story } = defineMeta({
    title: 'Agents/AgentSkillsPanel',
    component: AgentSkillsPanel,
    tags: ['autodocs'],
    // user.role=admin opens the `agents.skills.set` gate so the toggles render.
    parameters: { sveltekit_experimental: { state: { page: { url: new URL('http://localhost/agents'), data: { user: { role: 'admin' } } } } } },
    args: { agentId: 'panik' },
  });
</script>

<Story name="Loaded with missing deps banner" play={seed({ skills })}>
  {#snippet template(args)}<div class="w-[32rem] h-[28rem]"><AgentSkillsPanel {...args} /></div>{/snippet}
</Story>

<Story name="All enabled nothing missing" play={seed({ skills: skills.map((s) => ({ ...s, agentEnabled: true, disabled: false, missing: {} })) })}>
  {#snippet template(args)}<div class="w-[32rem] h-[28rem]"><AgentSkillsPanel {...args} /></div>{/snippet}
</Story>

<Story name="Saving" play={seed({ skills, saving: true })}>
  {#snippet template(args)}<div class="w-[32rem] h-[28rem]"><AgentSkillsPanel {...args} /></div>{/snippet}
</Story>

<Story name="Empty" play={seed()}>
  {#snippet template(args)}<div class="w-[32rem] h-[28rem]"><AgentSkillsPanel {...args} /></div>{/snippet}
</Story>

<Story name="Loading" play={seed({ loading: true })}>
  {#snippet template(args)}<div class="w-[32rem] h-[28rem]"><AgentSkillsPanel {...args} /></div>{/snippet}
</Story>

<Story name="Error" play={seed({ error: 'Error: skills.status timed out after 15 s' })}>
  {#snippet template(args)}<div class="w-[32rem] h-[28rem]"><AgentSkillsPanel {...args} /></div>{/snippet}
</Story>
