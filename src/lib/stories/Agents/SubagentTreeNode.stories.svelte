<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SubagentTreeNode from '$lib/components/agents/SubagentTreeNode.svelte';
  import { subagentState } from '$lib/state/features/subagent-data.svelte';
  import { piAgentState } from '$lib/state/features/pi-agent-state.svelte';
  import { running, completed, failed, nested, piEntries } from './subagent-fixtures';

  const leaf = (session) => ({ session, children: [] });
  // root → child-a (→ grandchild → great-grandchild) + child-b
  const tree = {
    session: nested[0],
    children: [
      { session: nested[1], children: [{ session: nested[3], children: [leaf(nested[4])] }] },
      leaf(nested[2]),
    ],
  };

  // Selection + kill/steer read the stores; reset them per story.
  const seed =
    (selectedKey = null, entries = []) =>
    async () => {
      subagentState.selectedKey = selectedKey;
      piAgentState.subagents = entries;
    };

  const { Story } = defineMeta({
    title: 'Agents/SubagentTreeNode',
    component: SubagentTreeNode,
    tags: ['autodocs'],
    args: { node: leaf(running), depth: 0 },
  });
</script>

<Story name="Running leaf" play={seed()}>
  {#snippet template(args)}<div class="w-96 bg-bg"><SubagentTreeNode {...args} /></div>{/snippet}
</Story>

<Story name="Completed with template badge" args={{ node: leaf(completed) }} play={seed()}>
  {#snippet template(args)}<div class="w-96 bg-bg"><SubagentTreeNode {...args} /></div>{/snippet}
</Story>

<Story name="Failed" args={{ node: leaf(failed) }} play={seed()}>
  {#snippet template(args)}<div class="w-96 bg-bg"><SubagentTreeNode {...args} /></div>{/snippet}
</Story>

<Story
  name="Selected at depth two"
  args={{ node: leaf(nested[3]), depth: 2 }}
  play={seed(nested[3].key)}
>
  {#snippet template(args)}<div class="w-96 bg-bg"><SubagentTreeNode {...args} /></div>{/snippet}
</Story>

<Story name="With children" args={{ node: tree }} play={seed()}>
  {#snippet template(args)}<div class="w-96 bg-bg"><SubagentTreeNode {...args} /></div>{/snippet}
</Story>

<Story name="With pi registry tokens" args={{ node: tree }} play={seed(null, piEntries)}>
  {#snippet template(args)}<div class="w-96 bg-bg"><SubagentTreeNode {...args} /></div>{/snippet}
</Story>
