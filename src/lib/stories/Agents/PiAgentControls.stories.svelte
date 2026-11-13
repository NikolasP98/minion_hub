<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import PiAgentControls from '$lib/components/agents/PiAgentControls.svelte';
  import { piAgentState } from '$lib/state/features/pi-agent-state.svelte';

  const usage = (percent: number) => ({
    tokenCount: Math.round(200_000 * (percent / 100)),
    contextWindow: 200_000,
    percent,
    messageCount: 48,
    compactionCount: 2,
  });
  const stats = {
    inputTokens: 184_210,
    outputTokens: 12_930,
    totalTokens: 197_140,
    turnCount: 23,
    toolCallCount: 61,
  };

  // No loader in the component; each story seeds the pi-agent store directly.
  const seed = (patch?: Partial<typeof piAgentState>) => async () => {
    Object.assign(
      piAgentState,
      {
        agentId: 'panik',
        loading: false,
        error: null,
        contextUsage: null,
        sessionStats: null,
        thinkingLevels: [],
        currentThinkingLevel: null,
      },
      patch,
    );
  };

  const { Story } = defineMeta({
    title: 'Components/Agents/PiAgentControls',
    component: PiAgentControls,
    tags: ['autodocs'],
    args: { agentId: 'panik' },
  });
</script>

<Story
  name="Healthy"
  play={seed({
    contextUsage: usage(34),
    sessionStats: stats,
    thinkingLevels: ['off', 'low', 'medium', 'high'],
    currentThinkingLevel: 'medium',
  })}
>
  {#snippet template(args)}<div class="w-[30rem]"><PiAgentControls {...args} /></div>{/snippet}
</Story>

<Story
  name="Context nearly full"
  play={seed({
    contextUsage: usage(93),
    sessionStats: stats,
    thinkingLevels: ['off', 'low', 'medium', 'high'],
    currentThinkingLevel: 'high',
  })}
>
  {#snippet template(args)}<div class="w-[30rem]"><PiAgentControls {...args} /></div>{/snippet}
</Story>

<Story
  name="Unknown window"
  play={seed({
    contextUsage: { ...usage(0), contextWindow: null, percent: null, tokenCount: 51_200 },
    sessionStats: stats,
  })}
>
  {#snippet template(args)}<div class="w-[30rem]"><PiAgentControls {...args} /></div>{/snippet}
</Story>

<Story name="No active session" play={seed()}>
  {#snippet template(args)}<div class="w-[30rem]"><PiAgentControls {...args} /></div>{/snippet}
</Story>
