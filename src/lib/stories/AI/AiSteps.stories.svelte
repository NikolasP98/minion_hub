<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AiSteps from '$lib/components/ai/AiSteps.svelte';
  import AiReasoning from '$lib/components/ai/AiReasoning.svelte';
  import AiToolCall from '$lib/components/ai/AiToolCall.svelte';
  import type { AIStep, AIToolStatus } from '$lib/components/ai/ai-state';

  // The fixtures carry the row payload next to the kind/status AiSteps reads.
  type Step = AIStep & { text?: string; name?: string; input?: string; result?: string };

  // Rows mirror ChatBlocks: one AiReasoning per thinking step, one AiToolCall per tool step.
  const TOOLS = [
    'bookings.search',
    'crm.contact.get',
    'fin.invoice.list',
    'stock.item.find',
    'web_search',
  ];
  const step = (i: number, status: AIToolStatus = 'success'): Step =>
    i % 4 === 0
      ? {
          kind: 'thinking',
          status,
          text: `Thinking about step ${i + 1}: which tool answers this best, and whether the previous result already covers it.`,
        }
      : {
          kind: 'tool',
          status,
          name: TOOLS[i % TOOLS.length],
          input: `{ "step": ${i + 1} }`,
          result: `ok (${i * 37} rows)`,
        };
  const steps = (n: number, failAt = -1, runningLast = false): Step[] =>
    Array.from({ length: n }, (_, i) =>
      step(i, i === failAt ? 'error' : runningLast && i === n - 1 ? 'running' : 'success'),
    );

  const { Story } = defineMeta({
    title: 'Components/AI/AiSteps',
    component: AiSteps,
    tags: ['autodocs'],
    argTypes: { running: { control: 'boolean' }, defaultOpen: { control: 'boolean' } },
    args: { steps: steps(3), running: false, turnKey: 'turn-1' },
  });
</script>

{#snippet rows(steps: Step[], running?: boolean)}
  {#each steps as s, i (i)}
    {#if s.kind === 'thinking'}
      <AiReasoning text={s.text ?? ''} active={running && i === steps.length - 1} />
    {:else}
      <AiToolCall
        name={s.name ?? ''}
        mono={false}
        status={s.status}
        input={s.input}
        result={s.status === 'running' ? undefined : s.result}
        summary={s.name}
      />
    {/if}
  {/each}
{/snippet}

<Story name="Three steps done">
  {#snippet template({ children: _children, ...args })}<AiSteps {...args}
      >{@render rows(args.steps, args.running)}</AiSteps
    >{/snippet}
</Story>

<Story name="Zero steps" args={{ steps: [] }}>
  {#snippet template({ children: _children, ...args })}<AiSteps {...args}
      >{@render rows(args.steps, args.running)}</AiSteps
    >{/snippet}
</Story>

<Story name="Twelve steps plus N overflow" args={{ steps: steps(12), turnKey: 'turn-12' }}>
  {#snippet template({ children: _children, ...args })}<AiSteps {...args}
      >{@render rows(args.steps, args.running)}</AiSteps
    >{/snippet}
</Story>

<Story
  name="Running active step timer ticks"
  args={{ steps: steps(4, -1, true), running: true, turnKey: 'turn-live' }}
>
  {#snippet template({ children: _children, ...args })}<AiSteps {...args}
      >{@render rows(args.steps, args.running)}</AiSteps
    >{/snippet}
</Story>

<Story name="One failed step" args={{ steps: steps(5, 2), turnKey: 'turn-fail' }}>
  {#snippet template({ children: _children, ...args })}<AiSteps {...args}
      >{@render rows(args.steps, args.running)}</AiSteps
    >{/snippet}
</Story>

<Story
  name="All tools failed"
  args={{ steps: [step(1, 'error'), step(2, 'error')], turnKey: 'turn-allfail' }}
>
  {#snippet template({ children: _children, ...args })}<AiSteps {...args}
      >{@render rows(args.steps, args.running)}</AiSteps
    >{/snippet}
</Story>

<Story name="Open by default" args={{ defaultOpen: true, steps: steps(6), turnKey: 'turn-open' }}>
  {#snippet template({ children: _children, ...args })}<AiSteps {...args}
      >{@render rows(args.steps, args.running)}</AiSteps
    >{/snippet}
</Story>

<Story
  name="Only thinking no tool uses"
  args={{ steps: [step(0), step(4)], turnKey: 'turn-think' }}
>
  {#snippet template({ children: _children, ...args })}<AiSteps {...args}
      >{@render rows(args.steps, args.running)}</AiSteps
    >{/snippet}
</Story>
