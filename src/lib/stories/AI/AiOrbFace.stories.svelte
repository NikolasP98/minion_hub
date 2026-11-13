<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AiOrbFace from '$lib/components/ai/AiOrbFace.svelte';
  import { EXPRESSIONS, type ExpressionName } from '$lib/components/ai/orb-face';

  const STATES = ['idle', 'listening', 'thinking', 'streaming', 'done', 'error'] as const;
  const EXPRESSION_NAMES = Object.keys(EXPRESSIONS) as ExpressionName[];
  // Fake microphone level: a slow pulse so "speaking"/"listening" visibly stir the orb.
  const pulse = () => 0.5 + 0.5 * Math.sin(Date.now() / 180);

  const { Story } = defineMeta({
    title: 'Components/AI/AiOrbFace',
    component: AiOrbFace,
    tags: ['autodocs'],
    argTypes: {
      status: { control: 'select', options: STATES },
      expression: { control: 'select', options: [undefined, ...Object.keys(EXPRESSIONS)] },
      diameter: { control: 'number' },
      gaze: { control: 'boolean' },
    },
    args: { status: 'idle', diameter: 128, gaze: true },
  });
</script>

<Story name="Idle" />
<Story name="Listening" args={{ status: 'listening', amplitude: pulse }} />
<Story name="Thinking squints looks away" args={{ status: 'thinking' }} />
<Story name="Speaking streaming amplitude" args={{ status: 'streaming', amplitude: pulse }} />
<Story name="Done hop" args={{ status: 'done' }} />
<Story name="Error spiral eyes wobble" args={{ status: 'error' }} />
<Story name="No gaze" args={{ gaze: false }} />
<Story name="Labelled accessible" args={{ 'aria-label': 'Minion assistant, idle' }} />

<Story name="All states">
  {#snippet template(args)}
    <div class="flex flex-wrap items-end gap-6">
      {#each STATES as status (status)}
        <div class="flex flex-col items-center gap-2">
          <AiOrbFace {...args} {status} amplitude={pulse} diameter={96} />
          <span class="t-caption text-muted-foreground">{status}</span>
        </div>
      {/each}
    </div>
  {/snippet}
</Story>

<Story name="All expressions">
  {#snippet template(args)}
    <div class="flex flex-wrap items-end gap-6">
      {#each EXPRESSION_NAMES as expression (expression)}
        <div class="flex flex-col items-center gap-2">
          <AiOrbFace {...args} {expression} diameter={72} gaze={false} />
          <span class="t-caption text-muted-foreground">{expression}</span>
        </div>
      {/each}
    </div>
  {/snippet}
</Story>

<Story name="Sizes 24 to 256">
  {#snippet template(args)}
    <div class="flex flex-wrap items-end gap-4">
      {#each [24, 40, 64, 96, 128, 256] as d (d)}
        <AiOrbFace {...args} diameter={d} />
      {/each}
    </div>
  {/snippet}
</Story>

<Story name="Fluid 100 pct of a 200 px box" args={{ diameter: '100%' }}>
  {#snippet template(args)}<div class="h-50 w-50"><AiOrbFace {...args} /></div>{/snippet}
</Story>
