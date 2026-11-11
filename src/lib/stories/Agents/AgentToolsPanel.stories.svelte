<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AgentToolsPanel from '$lib/components/agents/AgentToolsPanel.svelte';
  import { agentToolsState } from '$lib/state/agents/agent-tools.svelte';
  import type { ToolStatusEntry } from '$lib/types/tools';

  const tool = (
    id: string,
    groups: string[],
    enabled: boolean,
    extra: Partial<ToolStatusEntry> = {},
  ): ToolStatusEntry => ({ id, groups, enabled, ...extra });
  const tools = [
    tool('bash', ['group:runtime'], true, { display: { emoji: '⚡', title: 'Shell' } }),
    tool('read_file', ['group:fs'], true, { display: { title: 'Read file' } }),
    tool('write_file', ['group:fs'], true, { optional: true }),
    tool('web_search', ['group:web'], true, { mcpExport: true }),
    tool('calendar.create_event', ['group:google', 'group:scheduling'], false, {
      permission: { module: 'scheduling', action: 'create' },
    }),
    tool('gmail.send', ['group:google'], false, {
      multi: true,
      requires: { env: ['GOOGLE_CLIENT_ID'] },
    }),
    tool('sunat.issue_invoice', ['group:finance'], false, { optional: true }),
  ];

  // The panel loads via the gateway on mount (which fails here); each story seeds the store afterwards.
  const seed = (patch?: Partial<typeof agentToolsState>) => async () => {
    Object.assign(
      agentToolsState,
      { tools: [], groups: {}, profile: 'full', loading: false, error: null },
      patch,
    );
  };

  const { Story } = defineMeta({
    title: 'Components/Agents/AgentToolsPanel',
    component: AgentToolsPanel,
    tags: ['autodocs'],
    // user.role=admin opens the `tools.update` gate so the drag affordance renders.
    parameters: {
      sveltekit_experimental: {
        state: {
          page: { url: new URL('http://localhost/agents'), data: { user: { role: 'admin' } } },
        },
      },
    },
    args: { agentId: 'panik' },
  });
</script>

<Story
  name="Loaded"
  play={seed({
    tools,
    groups: { 'group:runtime': ['bash'], 'group:fs': ['read_file', 'write_file'] },
    profile: 'coding',
  })}
>
  {#snippet template(args)}<div class="w-[32rem] h-96"><AgentToolsPanel {...args} /></div>{/snippet}
</Story>

<Story name="All enabled" play={seed({ tools: tools.map((t) => ({ ...t, enabled: true })) })}>
  {#snippet template(args)}<div class="w-[32rem] h-96"><AgentToolsPanel {...args} /></div>{/snippet}
</Story>

<Story name="Empty" play={seed()}>
  {#snippet template(args)}<div class="w-[32rem] h-96"><AgentToolsPanel {...args} /></div>{/snippet}
</Story>

<Story name="Loading" play={seed({ loading: true })}>
  {#snippet template(args)}<div class="w-[32rem] h-96"><AgentToolsPanel {...args} /></div>{/snippet}
</Story>

<Story name="Error" play={seed({ error: 'Error: tools.status timed out after 15 s' })}>
  {#snippet template(args)}<div class="w-[32rem] h-96"><AgentToolsPanel {...args} /></div>{/snippet}
</Story>
