<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import BookingCreateDrawer from '$lib/components/scheduling/BookingCreateDrawer.svelte';

  const eventTypes = [
    {
      id: 'et-cons',
      title: 'Consultation',
      productId: 'p-cons',
      resourceIds: ['r-ana', 'r-luis'],
      length: 30,
      price: 120,
      currency: 'PEN',
      active: true,
    },
    {
      id: 'et-clean',
      title: 'Deep cleaning and whitening session',
      productId: 'p-clean',
      resourceIds: ['r-ana'],
      length: 90,
      price: 480.5,
      currency: 'PEN',
      active: true,
    },
    { id: 'et-fup', title: 'Follow-up', productId: null, length: 15, price: null, active: true },
    { id: 'et-old', title: 'Retired service', productId: null, length: 30, active: false },
  ];
  const resources = [
    { id: 'r-ana', name: 'Ana Quispe' },
    { id: 'r-luis', name: 'Luis Fernández de la Torre' },
  ];
  const target = { day: '2026-09-08', time: '10:30', resourceId: 'r-ana' };

  // Opens when `target` is non-null. Submitting posts to `bookEndpoint`, which
  // Storybook does not serve, so the form's request-failed state shows.
  const { Story } = defineMeta({
    title: 'Components/Calendar/BookingCreateDrawer',
    component: BookingCreateDrawer,
    tags: ['autodocs'],
    args: {
      target,
      eventTypes,
      resources,
      timeZone: 'America/Lima',
      mutationScope: 'org-demo',
      canBook: true,
      onclose: fn(),
      onbooked: fn(),
    },
  });
</script>

<Story name="Open (slot)" />
<Story name="Closed" args={{ target: null }} />
<Story
  name="Prefilled customer + service"
  args={{
    target: {
      ...target,
      customerName: 'María Fernanda Rodríguez Villanueva',
      partyId: 'party-1',
      eventTypeId: 'et-clean',
    },
  }}
/>
<Story
  name="From ticket line"
  args={{
    target: {
      ...target,
      ticketId: 'tk-1',
      lineId: 'ln-1',
      customerName: 'Jorge Paredes',
      partyId: 'party-2',
    },
  }}
/>
<Story name="Cannot book" args={{ canBook: false }} />
<Story name="Day only (no time, no staff)" args={{ target: { day: '2026-09-08' } }} />
