<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SubagentTree from '$lib/components/agents/SubagentTree.svelte';
  import { subagentState } from '$lib/state/features/subagent-data.svelte';
  import { piAgentState } from '$lib/state/features/pi-agent-state.svelte';
  import { AGENT_ID, nested, many, piEntries, orchestration } from './subagent-fixtures';

  // Reads the subagent + pi-agent stores (no data props); each story seeds them.
  const seed =
    (sessions, entries = [], orchs = []) =>
    async () => {
      Object.assign(subagentState, {
        agentId: AGENT_ID,
        sessions,
        selectedKey: null,
        loading: false,
        error: null,
      });
      piAgentState.subagents = entries;
      piAgentState.orchestrations = orchs;
    };

  const { Story } = defineMeta({
    title: 'Agents/SubagentTree',
    component: SubagentTree,
    tags: ['autodocs'],
  });
</script>

<Story name="Nested three levels" play={seed(nested)}>
  {#snippet template()}<div class="w-96 bg-bg"><SubagentTree /></div>{/snippet}
</Story>

<Story name="Grouped by orchestration" play={seed(nested, piEntries, [orchestration])}>
  {#snippet template()}<div class="w-96 bg-bg"><SubagentTree /></div>{/snippet}
</Story>

<Story name="Twenty flat" play={seed(many)}>
  {#snippet template()}<div class="w-96 bg-bg"><SubagentTree /></div>{/snippet}
</Story>

<Story name="Empty" play={seed([])}>
  {#snippet template()}<div class="w-96 bg-bg"><SubagentTree /></div>{/snippet}
</Story>
