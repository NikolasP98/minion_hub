<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import EventTypeEditor from '$lib/components/scheduling/EventTypeEditor.svelte';

  const resources = [
    { id: 'r-ana', name: 'Ana Quispe', kind: 'staff', email: 'ana@example.com', active: true },
    { id: 'r-luis', name: 'Luis Fernández de la Torre', kind: 'staff', email: null, active: true },
    { id: 'r-room', name: 'Room 2 (laser)', kind: 'room', active: true },
    { id: 'r-old', name: 'Former employee', kind: 'staff', active: false },
  ];
  const products = [
    { id: 'p-cons', name: 'Consultation' },
    { id: 'p-clean', name: 'Deep cleaning and whitening session' },
    { id: 'p-fup', name: 'Follow-up (free)' },
  ];
  const kinds = [
    {
      id: 'k-clinic',
      name: 'Clinical',
      color: 'var(--color-info-border)',
      isDefault: true,
      position: 0,
    },
    {
      id: 'k-admin',
      name: 'Administrative',
      color: 'var(--color-warning-border)',
      isDefault: false,
      position: 1,
    },
  ];
  const tags = [
    { id: 't-vip', name: 'VIP', color: 'var(--color-warning-border)' },
    { id: 't-promo', name: 'Promo September', color: null },
  ];

  const eventType = {
    id: 'et-clean',
    updatedAt: '2026-09-01T12:00:00.000Z',
    slug: 'deep-cleaning',
    title: 'Deep cleaning and whitening session',
    description: 'Includes fluoride application. Bring previous X-rays if available.',
    length: 90,
    slotInterval: 30,
    beforeBuffer: 10,
    afterBuffer: 15,
    minimumBookingNotice: 120,
    periodDays: 60,
    schedulingType: null,
    useCustomSchedule: true,
    scheduleRules: [{ days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '18:00' }],
    requiresConfirmation: true,
    public: true,
    productId: 'p-clean',
    resourceIds: ['r-ana', 'r-luis'],
    kindId: 'k-clinic',
  };

  const { Story } = defineMeta({
    title: 'Calendar/EventTypeEditor',
    component: EventTypeEditor,
    tags: ['autodocs'],
    parameters: {
      sveltekit_experimental: {
        state: {
          page: {
            data: {
              user: { role: 'admin' },
              permissions: { permissions: ['scheduling:create', 'scheduling:update'] },
            },
          },
        },
      },
    },
    args: { resources, products, kinds, tags, onsaved: fn(), oncancel: fn() },
  });
</script>

<Story name="New" />
<Story name="Editing" args={{ eventType, tagIds: ['t-vip'] }} />
<Story
  name="From preset"
  args={{
    preset: { title: 'Consultation', length: 30, productId: 'p-cons', resourceIds: ['r-ana'] },
  }}
/>
<Story
  name="No kinds, no tags"
  args={{
    kinds: [],
    tags: [],
    eventType: { ...eventType, kindId: null, useCustomSchedule: false, scheduleRules: [] },
  }}
/>

<!-- Responsive: the field grid is one column below md and two columns from 768px. -->
<Story
  name="Editing · Phone"
  args={{ eventType, tagIds: ['t-vip'] }}
  globals={{ viewport: { value: 'phone', isRotated: false } }}
/>
<Story
  name="Editing · Tablet"
  args={{ eventType, tagIds: ['t-vip'] }}
  globals={{ viewport: { value: 'tablet', isRotated: false } }}
/>
