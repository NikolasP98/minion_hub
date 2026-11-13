<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import DetailHeader from '$lib/components/layout/DetailHeader.svelte';
  import { gw } from '$lib/state/gateway/gateway-data.svelte';
  import { ui } from '$lib/state/ui/ui.svelte';

  const agent = {
    id: 'panik',
    name: 'PANIK - Your Personal Assistant',
    identity: { name: 'Panik' },
  };

  // Session counts are read from global state; each story seeds them.
  const seed = (statuses: typeof ui.sessionStatus) => async () => {
    gw.sessions = Object.keys(statuses).map((sessionKey, i) => ({
      sessionKey,
      updatedAt: Date.now() - i * 1000,
    }));
    ui.sessionStatus = statuses;
  };

  const { Story } = defineMeta({
    title: 'Components/Overlays/DetailHeader',
    component: DetailHeader,
    tags: ['autodocs'],
    args: { agentId: 'panik', agent },
  });
</script>

<Story name="Idle" play={seed({})}>
  {#snippet template(args)}<DetailHeader {...args} />{/snippet}
</Story>

<Story
  name="Running"
  play={seed({ 'agent:panik:main': 'running', 'agent:panik:telegram': 'running' })}
>
  {#snippet template(args)}<DetailHeader {...args} />{/snippet}
</Story>

<Story name="Thinking" play={seed({ 'agent:panik:main': 'thinking' })}>
  {#snippet template(args)}<DetailHeader {...args} />{/snippet}
</Story>

<Story
  name="Running and thinking"
  play={seed({
    'agent:panik:main': 'running',
    'agent:panik:wa': 'thinking',
    'agent:panik:idle': 'idle',
  })}
>
  {#snippet template(args)}<DetailHeader {...args} />{/snippet}
</Story>

<Story name="Emoji avatar" args={{ agent: { ...agent, emoji: '🤖' } }} play={seed({})}>
  {#snippet template(args)}<DetailHeader {...args} />{/snippet}
</Story>

<Story
  name="Long name"
  args={{
    agent: {
      id: 'ops',
      identity: { name: 'Operations and Fulfilment Coordination Assistant for the Lima branch' },
    },
  }}
  play={seed({})}
>
  {#snippet template(args)}<DetailHeader {...args} />{/snippet}
</Story>
