<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import type { ComponentProps } from 'svelte';
  import AgentCapabilitiesPanel from '$lib/components/agents/AgentCapabilitiesPanel.svelte';
  import { agentToolsState } from '$lib/state/agents/agent-tools.svelte';
  import { agentSkillsState } from '$lib/state/agents/agent-skills.svelte';

  const tools = [
    { id: 'bash', groups: ['group:runtime'], enabled: true },
    { id: 'read_file', groups: ['group:fs'], enabled: true },
    { id: 'gmail.send', groups: ['group:google'], enabled: false },
  ];
  const skills = ['scheduling', 'pos', 'reporting'].map((k, i) => ({
    skillKey: k,
    name: k,
    description: `The ${k} skill`,
    source: 'bundled',
    bundled: true,
    eligible: true,
    disabled: false,
    blockedByAllowlist: false,
    agentEnabled: i < 2,
    always: false,
    requirements: {},
    missing: {},
    install: [],
  }));

  // Child panels load via the gateway on mount (fails here); seed both stores afterwards.
  const seed = (t: typeof agentToolsState.tools, s: typeof agentSkillsState.skills) => async () => {
    Object.assign(agentToolsState, {
      tools: t,
      groups: {},
      profile: 'full',
      loading: false,
      error: null,
    });
    Object.assign(agentSkillsState, {
      skills: s,
      agentFilter: null,
      loading: false,
      saving: false,
      error: null,
    });
  };
  const skillsTab: Play = async (ctx) => {
    await seed(tools, skills)();
    await ctx.userEvent.click(ctx.canvas.getAllByRole('button')[1]);
  };

  const { Story } = defineMeta({
    title: 'Components/Agents/AgentCapabilitiesPanel',
    component: AgentCapabilitiesPanel,
    tags: ['autodocs'],
    parameters: {
      sveltekit_experimental: {
        state: {
          page: { url: new URL('http://localhost/agents'), data: { user: { role: 'admin' } } },
        },
      },
    },
    args: { agentId: 'panik' },
  });
  type Play = NonNullable<ComponentProps<typeof Story>['play']>;
</script>

<Story name="Tools tab" play={seed(tools, skills)}>
  {#snippet template(args)}<div class="w-[32rem] h-96">
      <AgentCapabilitiesPanel {...args} />
    </div>{/snippet}
</Story>

<Story name="Skills tab" play={skillsTab}>
  {#snippet template(args)}<div class="w-[32rem] h-96">
      <AgentCapabilitiesPanel {...args} />
    </div>{/snippet}
</Story>

<Story name="Empty no counts" play={seed([], [])}>
  {#snippet template(args)}<div class="w-[32rem] h-96">
      <AgentCapabilitiesPanel {...args} />
    </div>{/snippet}
</Story>
