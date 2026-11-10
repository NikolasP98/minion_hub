<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { expect, userEvent, within } from 'storybook/test';
  import FaqPublic from '$lib/components/doors/faq/Public.svelte';

  const door = { slug: 'faq', title: 'Preguntas frecuentes', description: null };
  const attribution = { door: 'door:faq' as const, at: '2026-11-10T09:00:00.000Z' };
  const entries = [
    { q: 'What are your opening hours?', a: 'Monday to Friday, 9:00 to 18:00.' },
    { q: 'Do I need to book ahead?', a: 'Yes. Walk-ins are welcome when a slot is free.' },
    {
      q: 'How do I cancel an appointment?',
      a: 'Reply to the confirmation message at least a day before.',
    },
  ];
  const longAnswer = Array.from(
    { length: 12 },
    (_, i) =>
      `Paragraph ${i + 1}: the aftercare steps are listed here in detail so the answer wraps over many lines.`,
  ).join('\n');

  const { Story } = defineMeta({
    title: 'Doors/FaqPublic',
    component: FaqPublic,
    tags: ['autodocs'],
    args: { door, attribution },
  });
</script>

<Story name="Several entries" args={{ data: { entries, whatsappNumber: null } }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><FaqPublic {...args} /></div>{/snippet}
</Story>

<Story
  name="Opening one closes the other"
  args={{ data: { entries, whatsappNumber: null } }}
  play={async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [first, second] = canvasElement.querySelectorAll('details');
    await userEvent.click(canvas.getByText(entries[0].q));
    await expect(first.open).toBe(true);
    await userEvent.click(canvas.getByText(entries[1].q));
    await expect(second.open).toBe(true);
    await expect(first.open).toBe(false);
  }}
>
  {#snippet template(args)}<div class="w-full max-w-xl"><FaqPublic {...args} /></div>{/snippet}
</Story>

<Story
  name="Long answer"
  args={{
    data: {
      entries: [{ q: 'What is the aftercare?', a: longAnswer }, ...entries.slice(0, 1)],
      whatsappNumber: null,
    },
  }}
>
  {#snippet template(args)}<div class="w-full max-w-xl"><FaqPublic {...args} /></div>{/snippet}
</Story>

<Story
  name="Single entry"
  args={{ data: { entries: entries.slice(0, 1), whatsappNumber: '+51 999 111 222' } }}
>
  {#snippet template(args)}<div class="w-full max-w-xl"><FaqPublic {...args} /></div>{/snippet}
</Story>

<Story name="Empty" args={{ data: { entries: [], whatsappNumber: null } }}>
  {#snippet template(args)}<div class="w-full max-w-xl"><FaqPublic {...args} /></div>{/snippet}
</Story>
