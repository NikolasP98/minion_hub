<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import AppointmentForm from '$lib/components/scheduling/AppointmentForm.svelte';

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

  // Submitting posts to `bookEndpoint`, which Storybook does not serve: the
  // request-failed state is reachable by clicking Book.
  const { Story } = defineMeta({
    title: 'Components/Calendar/AppointmentForm',
    component: AppointmentForm,
    tags: ['autodocs'],
    parameters: {
      sveltekit_experimental: {
        state: {
          page: { data: { permissions: { permissions: ['pos:create', 'scheduling:create'] } } },
        },
      },
    },
    args: {
      eventTypes,
      resources,
      timeZone: 'America/Lima',
      mutationScope: 'org-demo',
      canBook: true,
      onbooked: fn(),
      oncancel: fn(),
    },
  });
</script>

<Story name="Blank" />
<Story
  name="Prefilled slot + customer"
  args={{
    initialDate: '2026-09-08',
    initialTime: '10:30',
    initialResourceId: 'r-ana',
    initialEventTypeId: 'et-cons',
    initialCustomerName: 'María Fernanda Rodríguez Villanueva',
    initialPhone: '+51 987 654 321',
    initialPartyId: 'party-1',
  }}
/>
<Story
  name="Locked customer"
  args={{
    initialCustomerName: 'Jorge Paredes',
    initialPartyId: 'party-2',
    lockCustomer: true,
    initialDate: '2026-09-08',
  }}
/>
<Story
  name="Multi-service"
  args={{
    multiService: true,
    initialEventTypeId: 'et-cons',
    extraEventTypeIds: ['et-clean', 'et-fup'],
    initialDate: '2026-09-08',
    initialTime: '09:00',
    initialResourceId: 'r-ana',
  }}
/>
<Story name="Cannot book" args={{ canBook: false, initialEventTypeId: 'et-cons' }} />
<Story name="No services configured" args={{ eventTypes: [] }} />
