<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SubagentDetail from '$lib/components/agents/SubagentDetail.svelte';
  import { subagentState } from '$lib/state/features/subagent-data.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';
  import { AGENT_ID, running, completed } from './subagent-fixtures';

  // Reads the subagent + ui stores (no data props); each story seeds them. The Monitor tab
  // fetches the session's messages (fails here), so it lands on its error state.
  const seed = (selectedKey) => async () => {
    Object.assign(subagentState, {
      agentId: AGENT_ID,
      sessions: [running, completed],
      selectedKey,
      loading: false,
      error: null,
    });
    ui.selectedAgentId = AGENT_ID;
    ui.selectedServerId = null;
  };
  const metaTab = async (ctx) => {
    await seed(running.key)();
    await ctx.userEvent.click(ctx.canvas.getByRole('button', { name: 'Meta' }));
  };

  const { Story } = defineMeta({
    title: 'Agents/SubagentDetail',
    component: SubagentDetail,
    tags: ['autodocs'],
  });
</script>

<Story name="Nothing selected" play={seed(null)}>
  {#snippet template()}<div class="w-[32rem] h-80"><SubagentDetail /></div>{/snippet}
</Story>

<Story name="Selected monitor tab" play={seed(running.key)}>
  {#snippet template()}<div class="w-[32rem] h-80"><SubagentDetail /></div>{/snippet}
</Story>

<Story name="Selected meta tab" play={metaTab}>
  {#snippet template()}<div class="w-[32rem] h-80"><SubagentDetail /></div>{/snippet}
</Story>
