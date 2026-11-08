<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SubagentTimeline from '$lib/components/agents/SubagentTimeline.svelte';
  import { subagentState } from '$lib/state/features/subagent-data.svelte';
  import { AGENT_ID, running, completed, failed, many } from './subagent-fixtures';

  const yesterday = { ...completed, key: `${completed.key}-y`, updatedAt: Date.now() - 20 * 3_600_000 };
  const lastWeek = { ...failed, key: `${failed.key}-w`, updatedAt: Date.now() - 6 * 86_400_000 };

  // Reads the subagent store (no data props); each story seeds it.
  const seed = (sessions, selectedKey = null) => async () => {
    Object.assign(subagentState, { agentId: AGENT_ID, sessions, selectedKey, loading: false, error: null });
  };

  const { Story } = defineMeta({
    title: 'Agents/SubagentTimeline',
    component: SubagentTimeline,
    tags: ['autodocs'],
  });
</script>

<Story name="Today yesterday and older" play={seed([running, completed, yesterday, lastWeek], completed.key)}>
  {#snippet template()}<div class="w-96 bg-bg"><SubagentTimeline /></div>{/snippet}
</Story>

<Story name="Twenty sessions" play={seed(many)}>
  {#snippet template()}<div class="w-96 h-96 overflow-y-auto bg-bg"><SubagentTimeline /></div>{/snippet}
</Story>

<Story name="Empty" play={seed([])}>
  {#snippet template()}<div class="w-96 bg-bg"><SubagentTimeline /></div>{/snippet}
</Story>
