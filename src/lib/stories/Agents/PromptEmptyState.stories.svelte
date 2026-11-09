<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import EmptyState from '$lib/components/prompt/EmptyState.svelte';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { promptSections } from '$lib/state/features/prompt-sections.svelte';

  // The embedded AgentSelector reads the gateway agent list + prompt-sections store.
  const seed = (list) => async () => {
    gw.agents = list;
    promptSections.agentId = null;
  };

  const { Story } = defineMeta({
    title: 'Agents/PromptEmptyState',
    component: EmptyState,
    tags: ['autodocs'],
    parameters: {
      sveltekit_experimental: {
        state: { page: { url: new URL('http://localhost/prompt'), data: {} } },
      },
    },
  });
</script>

<Story
  name="With agents to pick"
  play={seed([
    { id: 'panik', name: 'Panik' },
    { id: 'faces-clinic', name: 'Faces Clinic' },
  ])}
>
  {#snippet template()}<div class="w-[40rem] h-80 flex"><EmptyState /></div>{/snippet}
</Story>

<Story name="No agents" play={seed([])}>
  {#snippet template()}<div class="w-[40rem] h-80 flex"><EmptyState /></div>{/snippet}
</Story>
