<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import type { ComponentProps } from 'svelte';
  import SubagentList from '$lib/components/agents/SubagentList.svelte';
  import { subagentState, type SubagentSession } from '$lib/state/features/subagent-data.svelte';
  import { piAgentState } from '$lib/state/features/pi-agent-state.svelte';
  import { AGENT_ID, running, nested, many, piEntries, orchestration } from './subagent-fixtures';

  // The list reads the subagent store (no data props); each story seeds it.
  const seed = (sessions: SubagentSession[], patch?: Partial<typeof subagentState>) => async () => {
    Object.assign(
      subagentState,
      { agentId: AGENT_ID, sessions, selectedKey: null, loading: false, error: null },
      patch,
    );
    piAgentState.subagents = [];
    piAgentState.orchestrations = [];
  };
  const view =
    (sessions: SubagentSession[], label: string): Play =>
    async (ctx) => {
      await seed(sessions)();
      piAgentState.subagents = piEntries;
      piAgentState.orchestrations = [orchestration];
      await ctx.userEvent.click(ctx.canvas.getByRole('button', { name: label }));
    };

  const { Story } = defineMeta({
    title: 'Components/Agents/SubagentList',
    component: SubagentList,
    tags: ['autodocs'],
  });
  type Play = NonNullable<ComponentProps<typeof Story>['play']>;
</script>

<Story name="Zero subagents" play={seed([])}>
  {#snippet template()}<div class="w-80 h-96"><SubagentList /></div>{/snippet}
</Story>

<Story name="One subagent" play={seed([running])}>
  {#snippet template()}<div class="w-80 h-96"><SubagentList /></div>{/snippet}
</Story>

<Story name="Nested three levels" play={seed(nested, { selectedKey: nested[1].key })}>
  {#snippet template()}<div class="w-80 h-96"><SubagentList /></div>{/snippet}
</Story>

<Story name="Twenty subagents" play={seed(many)}>
  {#snippet template()}<div class="w-80 h-96"><SubagentList /></div>{/snippet}
</Story>

<Story name="Tree view" play={view(nested, 'Tree')}>
  {#snippet template()}<div class="w-80 h-96"><SubagentList /></div>{/snippet}
</Story>

<Story name="Timeline view" play={view(many, 'Timeline')}>
  {#snippet template()}<div class="w-80 h-96"><SubagentList /></div>{/snippet}
</Story>

<Story name="Loading" play={seed([], { loading: true })}>
  {#snippet template()}<div class="w-80 h-96"><SubagentList /></div>{/snippet}
</Story>

<Story name="Error" play={seed([], { error: 'sessions.list: not connected' })}>
  {#snippet template()}<div class="w-80 h-96"><SubagentList /></div>{/snippet}
</Story>
