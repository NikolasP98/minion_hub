<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import AssistChoice from '$lib/components/assistant/AssistChoice.svelte';

  const options = [
    { label: 'Show me how' },
    { label: 'Just do it', value: 'Do it for me' },
    { label: 'Explain first' },
  ];

  const { Story } = defineMeta({
    title: 'Components/AI/AssistChoice',
    component: AssistChoice,
    tags: ['autodocs'],
    args: { question: 'Do you want to learn this, or should I do it?', options, onPick: fn() },
  });
</script>

<Story name="Three options" />
<Story name="Two options" args={{ options: options.slice(0, 2) }} />
<Story name="Read only no onPick" args={{ onPick: undefined }} />
<Story
  name="Long labels"
  args={{
    options: [
      {
        label:
          'Walk me through creating the event type, the availability and the first booking step by step',
      },
      { label: 'Create everything with sensible defaults and tell me what you changed afterwards' },
    ],
  }}
/>
<Story
  name="Many options"
  args={{ options: Array.from({ length: 7 }, (_, i) => ({ label: `Option ${i + 1}` })) }}
/>

<Story name="Narrow host">
  {#snippet template(args)}<div class="w-64"><AssistChoice {...args} /></div>{/snippet}
</Story>
