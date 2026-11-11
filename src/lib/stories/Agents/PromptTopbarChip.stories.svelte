<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import type { PromptMode } from '@minion-stack/shared';
  import PromptTopbarChip from '$lib/components/prompt/PromptTopbarChip.svelte';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { promptSections } from '$lib/state/features/prompt-sections.svelte';

  const agents = [
    { id: 'panik', name: 'Panik' },
    { id: 'faces-clinic', name: 'Faces Clinic' },
  ];
  // Agent options come from the gateway list; agent + mode from the prompt-sections store.
  const seed =
    (agentId: string | null, mode: PromptMode = 'full') =>
    async () => {
      gw.agents = agents;
      promptSections.agentId = agentId;
      promptSections.mode = mode;
    };

  const { Story } = defineMeta({
    title: 'Components/Agents/PromptTopbarChip',
    component: PromptTopbarChip,
    tags: ['autodocs'],
    parameters: {
      sveltekit_experimental: {
        state: { page: { url: new URL('http://localhost/prompt'), data: {} } },
      },
    },
  });
</script>

<Story name="Full mode no agent" play={seed(null)} />
<Story name="Minimal mode with agent" play={seed('panik', 'minimal')} />
<Story name="None mode" play={seed('faces-clinic', 'none')} />
