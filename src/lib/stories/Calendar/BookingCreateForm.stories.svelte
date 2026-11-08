<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import BookingCreateForm from '$lib/components/scheduling/BookingCreateForm.svelte';

  const eventTypes = [
    { id: 'et-cons', title: 'Consultation', productId: 'p-cons', active: true, length: 30, kindId: 'k-clinic' },
    { id: 'et-clean', title: 'Deep cleaning and whitening session', productId: 'p-clean', active: true, length: 90, kindId: 'k-clinic' },
    { id: 'et-fup', title: 'Follow-up', productId: null, active: true, length: 15, kindId: 'k-admin' },
    { id: 'et-old', title: 'Retired service', productId: null, active: false, length: 30, kindId: null },
  ];
  const kinds = [
    { id: 'k-clinic', name: 'Clinical', color: 'var(--color-info-border)', isDefault: true, position: 0 },
    { id: 'k-admin', name: 'Administrative', color: 'var(--color-warning-border)', isDefault: false, position: 1 },
  ];
  const tags = [
    { id: 't-vip', name: 'VIP', color: 'var(--color-warning-border)' },
    { id: 't-new', name: 'New patient', color: null },
  ];

  // Submitting posts to the bookings API, which Storybook does not serve: the
  // request-failed state is reachable by submitting.
  const { Story } = defineMeta({
    title: 'Calendar/BookingCreateForm',
    component: BookingCreateForm,
    tags: ['autodocs'],
    parameters: {
      sveltekit_experimental: {
        state: { page: { url: new URL('http://localhost/scheduling/bookings/new'), data: { permissions: { permissions: ['scheduling:create'] } } } },
      },
    },
    args: { eventTypes, kinds, tags, timeZone: 'America/Lima', mutationScope: 'org-demo' },
  });
</script>

<Story name="Blank" />
<Story name="With contact prefill" args={{ contact: { id: 'c-1', partyId: 'party-1', name: 'María Fernanda Rodríguez Villanueva', phone: '+51 987 654 321' } }} />
<Story name="No kinds or tags" args={{ kinds: [], tags: [] }} />
<Story name="No services configured" args={{ eventTypes: [] }} />
<Story name="Viewer (cannot create)" parameters={{ sveltekit_experimental: { state: { page: { url: new URL('http://localhost/scheduling/bookings/new'), data: { permissions: { permissions: [] } } } } } }} />

<!-- Responsive: the top section is one column below 768px and two columns from 768px. -->
<Story name="Blank · Phone" globals={{ viewport: { value: 'phone', isRotated: false } }} />
<Story name="Blank · Tablet" globals={{ viewport: { value: 'tablet', isRotated: false } }} />
