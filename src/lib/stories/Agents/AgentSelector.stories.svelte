<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AgentSelector from '$lib/components/prompt/AgentSelector.svelte';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { promptSections } from '$lib/state/features/prompt-sections.svelte';

  const agents = [
    { id: 'panik', name: 'Panik' },
    { id: 'faces-clinic', name: 'Faces Clinic' },
    { id: 'reminders', name: 'Reminders' },
  ];
  // Options come from the gateway agent list and the selection from the prompt-sections store.
  const seed =
    (list, agentId = null) =>
    async () => {
      gw.agents = list;
      promptSections.agentId = agentId;
    };

  const { Story } = defineMeta({
    title: 'Agents/AgentSelector',
    component: AgentSelector,
    tags: ['autodocs'],
    parameters: {
      sveltekit_experimental: {
        state: { page: { url: new URL('http://localhost/prompt'), data: {} } },
      },
    },
  });
</script>

<Story name="Nothing selected" play={seed(agents)} />
<Story name="Agent selected" play={seed(agents, 'faces-clinic')} />
<Story name="No agents" play={seed([])} />
