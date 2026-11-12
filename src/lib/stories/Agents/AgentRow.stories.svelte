<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import AgentRow from '$lib/components/agents/AgentRow.svelte';
  import {
    agentActivity,
    agentChat,
    ensureAgentActivity,
    ensureAgentChat,
    SPARK_BIN_COUNT,
  } from '$lib/state/chat/chat.svelte';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';
  import { ACCENT_OPTIONS } from '$lib/themes/presets';

  const agent = { id: 'panik', name: 'PANIK', identity: { name: 'Panik' }, status: 'idle' };
  const bins = Array.from({ length: SPARK_BIN_COUNT }, (_, i) =>
    Math.max(0, Math.round(Math.sin(i / 9) * 6 + 5)),
  );

  // Status is read from the chat/gateway stores, not props — each story seeds them.
  const seed = (patch?: () => void) => async () => {
    delete agentActivity[agent.id];
    delete agentChat[agent.id];
    gw.sessions.length = 0;
    ui.sessionStatus = {};
    patch?.();
  };
  const working = () =>
    Object.assign(ensureAgentActivity(agent.id), {
      working: true,
      lastEventAt: Date.now(),
      sparkBins: bins,
    });
  const thinking = () => {
    gw.sessions.push(
      { sessionKey: `agent:${agent.id}:main` },
      { sessionKey: `agent:${agent.id}:whatsapp:dm:+51999888777` },
    );
    ui.sessionStatus = {
      [`agent:${agent.id}:main`]: 'thinking',
      [`agent:${agent.id}:whatsapp:dm:+51999888777`]: 'running',
    };
  };

  const { Story } = defineMeta({
    title: 'Components/Agents/AgentRow',
    component: AgentRow,
    tags: ['autodocs'],
    argTypes: { selected: { control: 'boolean' }, compact: { control: 'boolean' } },
    // EChartsSparkline appends a hex alpha to `color`, so pass the resolved accent hex.
    args: {
      agent,
      selected: false,
      accentColor: ACCENT_OPTIONS[0].value,
      onclick: fn(),
      compact: false,
    },
  });
</script>

<Story name="Idle" play={seed()}>
  {#snippet template(args)}<div class="w-64 bg-bg2"><AgentRow {...args} /></div>{/snippet}
</Story>

<Story name="Selected" args={{ selected: true }} play={seed()}>
  {#snippet template(args)}<div class="w-64 bg-bg2"><AgentRow {...args} /></div>{/snippet}
</Story>

<Story name="Running working" play={seed(working)}>
  {#snippet template(args)}<div class="w-64 bg-bg2"><AgentRow {...args} /></div>{/snippet}
</Story>

<Story name="Thinking two active sessions" play={seed(thinking)}>
  {#snippet template(args)}<div class="w-64 bg-bg2"><AgentRow {...args} /></div>{/snippet}
</Story>

<Story name="Loading history" play={seed(() => (ensureAgentChat(agent.id).loading = true))}>
  {#snippet template(args)}<div class="w-64 bg-bg2"><AgentRow {...args} /></div>{/snippet}
</Story>

<Story
  name="Emoji avatar"
  args={{
    agent: { ...agent, id: 'faces-clinic', emoji: '🦷', identity: { name: 'Faces Clinic' } },
  }}
  play={seed()}
>
  {#snippet template(args)}<div class="w-64 bg-bg2"><AgentRow {...args} /></div>{/snippet}
</Story>

<Story
  name="Long name"
  args={{
    agent: {
      ...agent,
      id: 'long',
      identity: { name: 'Appointment Scheduling And Reminder Coordinator For Both Clinics' },
    },
  }}
  play={seed()}
>
  {#snippet template(args)}<div class="w-64 bg-bg2"><AgentRow {...args} /></div>{/snippet}
</Story>

<Story name="Compact idle" args={{ compact: true }} play={seed()}>
  {#snippet template(args)}<div class="w-14 bg-bg2"><AgentRow {...args} /></div>{/snippet}
</Story>

<Story
  name="Compact running selected"
  args={{ compact: true, selected: true }}
  play={seed(working)}
>
  {#snippet template(args)}<div class="w-14 bg-bg2"><AgentRow {...args} /></div>{/snippet}
</Story>
