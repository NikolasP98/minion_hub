<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import SubagentEmptyState from '$lib/components/agents/SubagentEmptyState.svelte';

  const { Story } = defineMeta({
    title: 'Components/Agents/SubagentEmptyState',
    component: SubagentEmptyState,
    tags: ['autodocs'],
  });
</script>

<Story name="Default">
  {#snippet template()}<div class="w-80 h-64 bg-bg"><SubagentEmptyState /></div>{/snippet}
</Story>
