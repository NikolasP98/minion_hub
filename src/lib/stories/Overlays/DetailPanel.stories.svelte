<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import DetailPanel from '$lib/components/layout/DetailPanel.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';

  // No props: reads ui.selectedAgentId + gw.agents. With no agent selected it
  // renders WelcomePanel; the agent view (AgentDetail) needs a live gateway.
  const { Story } = defineMeta({
    title: 'Components/Overlays/DetailPanel',
    component: DetailPanel,
    tags: ['autodocs'],
  });
</script>

<Story
  name="Welcome (no agent selected)"
  play={async () => {
    ui.selectedAgentId = null;
  }}
>
  {#snippet template()}
    <div class="h-[520px] flex surface-1"><DetailPanel /></div>
  {/snippet}
</Story>

<!-- Responsive: the panel fills its host width. -->
<Story
  name="Welcome (no agent selected) · Phone"
  play={async () => {
    ui.selectedAgentId = null;
  }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
>
  {#snippet template()}
    <div class="h-[520px] flex surface-1"><DetailPanel /></div>
  {/snippet}
</Story>
