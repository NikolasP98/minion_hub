<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import AiReasoning from '$lib/components/ai/AiReasoning.svelte';

  const text =
    "The user asks for next week's bookings. I should call bookings.search with a date range rather than listing everything, then group by resource so the answer reads as a schedule.";
  const long = Array.from(
    { length: 18 },
    (_, i) =>
      `Step ${i + 1}: ${['Check the calendar window', 'Compare with the member roster', 'Look for overlapping slots', 'Decide whether to ask a clarifying question'][i % 4]}. ${'Reasoning continues with more detail than anyone needs to read in full. '.repeat(2 + (i % 3))}`,
  ).join('\n\n');

  const { Story } = defineMeta({
    title: 'AI/AiReasoning',
    component: AiReasoning,
    tags: ['autodocs'],
    argTypes: { active: { control: 'boolean' }, compact: { control: 'boolean' } },
    args: { text, active: false, collapseWhenDone: true },
  });
</script>

<Story name="Streaming active open shimmer" args={{ active: true }} />
<Story name="Complete collapsed with duration" args={{ duration: 4.2 }} />
<Story name="Complete stays open" args={{ duration: 12, collapseWhenDone: false }} />
<Story name="Complete no duration known" />
<Story name="Custom active label" args={{ active: true, activeLabel: 'Reviewing results' }} />
<Story name="Long trace" args={{ text: long, duration: 38, collapseWhenDone: false }} />
<Story name="Long duration 2 h" args={{ duration: 7312 }} />
<Story name="Compact" args={{ compact: true, duration: 2 }} />
<Story name="Compact active" args={{ compact: true, active: true }} />
