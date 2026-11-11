<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import EventCard from '$lib/components/my-agent/EventCard.svelte';
  import type { CalendarItem } from '$lib/services/my-agent-rpc';

  // One shared "now" so every story's proximity tier is deterministic relative to it.
  const nowMs = Date.now();
  const at = (minutes: number) => new Date(nowMs + minutes * 60_000).toISOString();
  const dayAt = (days: number) => new Date(nowMs + days * 86_400_000).toISOString().slice(0, 10);
  const item = (
    startMin: number,
    durationMin: number,
    extra: Partial<CalendarItem> = {},
  ): CalendarItem => ({
    id: `ev-${startMin}`,
    sourceEmail: 'nikolas@example.com',
    title: 'Cleaning · Ana Torres',
    startsAt: at(startMin),
    endsAt: at(startMin + durationMin),
    isAllDay: false,
    location: null,
    htmlLink: 'https://calendar.google.com/',
    ...extra,
  });

  const { Story } = defineMeta({
    title: 'Components/Sessions/EventCard',
    component: EventCard,
    tags: ['autodocs'],
    args: { item: item(180, 45), nowMs, onopen: fn() },
  });
</script>

<Story name="Later today">
  {#snippet template(args)}<div class="w-80"><EventCard {...args} /></div>{/snippet}
</Story>

<Story name="In progress" args={{ item: item(-10, 45) }}>
  {#snippet template(args)}<div class="w-80"><EventCard {...args} /></div>{/snippet}
</Story>

<Story name="Starting soon" args={{ item: item(12, 30) }}>
  {#snippet template(args)}<div class="w-80"><EventCard {...args} /></div>{/snippet}
</Story>

<Story name="Starting now" args={{ item: item(1, 30) }}>
  {#snippet template(args)}<div class="w-80"><EventCard {...args} /></div>{/snippet}
</Story>

<Story name="Past" args={{ item: item(-120, 30) }}>
  {#snippet template(args)}<div class="w-80"><EventCard {...args} /></div>{/snippet}
</Story>

<Story
  name="Tomorrow with location recurring accepted"
  args={{
    item: item(26 * 60, 60, {
      location: 'Clínica Faces, Av. Larco 1301, Miraflores',
      recurring: true,
      responseStatus: 'accepted',
    }),
  }}
>
  {#snippet template(args)}<div class="w-80"><EventCard {...args} /></div>{/snippet}
</Story>

<Story name="Declined" args={{ item: item(200, 30, { responseStatus: 'declined' }) }}>
  {#snippet template(args)}<div class="w-80"><EventCard {...args} /></div>{/snippet}
</Story>

<Story name="Tentative" args={{ item: item(200, 30, { responseStatus: 'tentative' }) }}>
  {#snippet template(args)}<div class="w-80"><EventCard {...args} /></div>{/snippet}
</Story>

<Story name="Needs action" args={{ item: item(200, 30, { responseStatus: 'needsAction' }) }}>
  {#snippet template(args)}<div class="w-80"><EventCard {...args} /></div>{/snippet}
</Story>

<Story
  name="All day"
  args={{
    item: {
      ...item(0, 0),
      startsAt: dayAt(0),
      endsAt: dayAt(1),
      isAllDay: true,
      title: 'Clinic closed · staff training',
    },
  }}
>
  {#snippet template(args)}<div class="w-80"><EventCard {...args} /></div>{/snippet}
</Story>

<Story
  name="Shared account"
  args={{ item: item(90, 30, { shared: true, sharedOwnerName: 'Dra. Pérez' }) }}
>
  {#snippet template(args)}<div class="w-80"><EventCard {...args} /></div>{/snippet}
</Story>

<Story name="Untitled" args={{ item: item(90, 30, { title: '' }) }}>
  {#snippet template(args)}<div class="w-80"><EventCard {...args} /></div>{/snippet}
</Story>

<Story
  name="Long title and location"
  args={{
    item: item(90, 30, {
      title:
        'Quarterly review with the accountant about SUNAT electronic invoicing, payroll and the new lease',
      location: 'Estudio contable, piso 14, oficina 1402, Av. Javier Prado Este 4200, Surco',
    }),
  }}
>
  {#snippet template(args)}<div class="w-80"><EventCard {...args} /></div>{/snippet}
</Story>
