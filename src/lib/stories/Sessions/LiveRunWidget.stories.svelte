<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import type { Agent } from '@minion-stack/shared';
  import type { PlayFunction } from 'storybook/internal/types';
  import LiveRunWidget from '$lib/components/sessions/LiveRunWidget.svelte';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { conn } from '$lib/state/gateway/connection.svelte';
  import { agentActivity, ensureAgentActivity } from '$lib/state/chat/chat.svelte';

  // The widget lists agents whose gateway status is running/thinking; nothing renders when idle.
  const agent = (id: string, name: string, status: string, agoMs: number): Agent => {
    ensureAgentActivity(id).lastEventAt = Date.now() - agoMs;
    return { id, name, status };
  };
  const seed = (make?: () => Agent[]) => async () => {
    for (const k of Object.keys(agentActivity)) delete agentActivity[k];
    gw.agents = [];
    Object.assign(conn, { connected: false, connecting: false });
    if (make) {
      conn.connected = true;
      gw.agents = make();
    }
  };
  const one = () => [agent('panik', 'Panik', 'running', 42_000)];
  const many = () => [
    agent('panik', 'Panik', 'running', 42_000),
    agent('faces-clinic', 'Faces Clinic', 'thinking', 3_000),
    agent('reminders', 'Reminders', 'running', 7 * 60_000 + 15_000),
    agent('bookkeeper', 'Bookkeeper with a very long display name', 'thinking', 125 * 60_000),
    agent('triage', 'Triage', 'running', 1_000),
  ];
  const collapse: PlayFunction = async (ctx) => {
    await seed(many)();
    await ctx.userEvent.click(ctx.canvas.getAllByRole('button')[0]);
  };

  const { Story } = defineMeta({
    title: 'Components/Sessions/LiveRunWidget',
    component: LiveRunWidget,
    tags: ['autodocs'],
    parameters: {
      sveltekit_experimental: {
        state: { page: { url: new URL('http://localhost/sessions'), data: {} } },
      },
      docs: { story: { inline: false, height: '200px' } },
    },
  });
</script>

<Story name="Idle renders nothing" play={seed()}>
  {#snippet template()}
    <p class="text-sm text-muted-foreground">Nothing mounts while no agent is running.</p>
    <LiveRunWidget />
  {/snippet}
</Story>

<Story name="One run" play={seed(one)}>
  {#snippet template()}<LiveRunWidget />{/snippet}
</Story>

<Story name="Many runs" play={seed(many)}>
  {#snippet template()}<LiveRunWidget />{/snippet}
</Story>

<Story name="Collapsed" play={collapse}>
  {#snippet template()}<LiveRunWidget />{/snippet}
</Story>

<Story
  name="Many runs · Phone"
  globals={{ viewport: { value: 'phone', isRotated: false } }}
  play={seed(many)}
>
  {#snippet template()}<LiveRunWidget />{/snippet}
</Story>
