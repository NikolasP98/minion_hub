<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import EaselBoard from '$lib/components/my-agent/EaselBoard.svelte';
  import ZenMode from '$lib/components/my-agent/ZenMode.svelte';
  import AgentSettingsPanel from '$lib/components/agents/AgentSettingsPanel.svelte';
  import { Button } from '$lib/components/ui';
  import { ui } from '$lib/state/ui/ui.svelte';
  import type { AgentNote } from '$lib/state/features/agent-notes.svelte';

  // Surfaces that fill the screen (or its right edge) inside the shared dialog (`bare`,
  // clear backdrop). The stories exist for the modal behaviour: the page behind is inert,
  // focus moves in and returns, Escape closes.
  const { Story } = defineMeta({
    title: 'Components/Overlays/FullScreenModals',
    tags: ['autodocs'],
    parameters: { docs: { story: { inline: false, height: '560px' } } },
  });

  const now = Date.now();
  const make = (id: string, kind: AgentNote['kind'], title: string): AgentNote => ({
    id,
    kind,
    title,
    body: '',
    items: [],
    attachments: [],
    easel: { items: [] },
    blocks: [],
    color: 'default',
    pinned: false,
    createdAt: now,
    updatedAt: now,
  });
  const board = make('sb-fs-easel', 'easel', 'Clinic layout');
  const focusNote: AgentNote = {
    ...make('sb-fs-note', 'note', 'Launch plan'),
    blocks: [{ id: 't1', type: 'text', md: 'Two weeks of promotions.', attachments: [] }],
  };
</script>

<script lang="ts">
  let easelOpen = $state(false);
  let zenOpen = $state(false);
</script>

<Story name="Easel board">
  {#snippet template()}
    <Button size="sm" onclick={() => (easelOpen = true)}>Open board</Button>
    <Button size="sm" variant="ghost">Behind the board</Button>
    <p data-last>Open: {easelOpen}</p>
    {#if easelOpen}
      <EaselBoard note={board} onclose={() => (easelOpen = false)} />
    {/if}
  {/snippet}
</Story>

<Story name="Focus mode">
  {#snippet template()}
    <Button size="sm" onclick={() => (zenOpen = true)}>Focus mode</Button>
    <Button size="sm" variant="ghost">Behind focus mode</Button>
    <p data-last>Open: {zenOpen}</p>
    <ZenMode note={zenOpen ? focusNote : null} onclose={() => (zenOpen = false)} />
  {/snippet}
</Story>

<Story name="Agent settings drawer">
  {#snippet template()}
    <Button size="sm" onclick={() => (ui.agentSettingsOpen = true)}>Agent settings</Button>
    <Button size="sm" variant="ghost">Behind the drawer</Button>
    <p data-last>Open: {ui.agentSettingsOpen}</p>
    {#if ui.agentSettingsOpen}
      <AgentSettingsPanel agentId="agent-alpha" />
    {/if}
  {/snippet}
</Story>
