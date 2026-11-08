<script module>
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import BookingCustomFields from '$lib/components/scheduling/BookingCustomFields.svelte';

  // Plain-object stand-in for the `BookingCustomValues` store: the component only
  // reads `failed`, `values`, `bundle()`, `apply()` and `refetch()`.
  const ts = '2026-11-01T10:00:00.000Z';
  const def = (id, label, type, rules, over = {}) => ({
    id,
    tableId: 'scheduling.bookings',
    label,
    description: null,
    type,
    rules,
    hasDefault: false,
    defaultValue: null,
    presentation: null,
    version: 1,
    archivedAt: null,
    createdAt: ts,
    updatedAt: ts,
    ...over,
  });
  const defs = [
    def('room', 'Room', 'select', { type: 'select', options: [{ id: 'r1', label: 'Room 1', color: null }, { id: 'r2', label: 'Room 2', color: null }] }),
    def('deposit', 'Deposit', 'number', { type: 'number', min: 0, max: null, precision: 2 }),
    def('consent', 'Consent signed', 'boolean', { type: 'boolean' }),
    def('notes', 'Prep notes', 'text', { type: 'text', maxLength: 500 }),
  ];
  const cell = (propertyId, recordId, value) => ({ propertyId, recordId, present: value !== null, value, effectiveValue: value, version: 1, updatedAt: ts });
  const values = (bookingId, v) => ({ [bookingId]: Object.fromEntries(defs.map((d) => [d.id, cell(d.id, bookingId, v[d.id] ?? null)])) });
  const store = ({ bookingId = 'bk-1', vals = {}, canEdit = true, failed = false, loaded = true } = {}) => {
    const bundle = {
      definitions: defs,
      values: loaded ? values(bookingId, vals) : {},
      recordAccess: loaded ? { [bookingId]: { canEdit } } : {},
      canManage: canEdit,
      canEdit,
    };
    return {
      failed,
      values: bundle.values,
      bundle: () => bundle,
      apply: async () => ({ ok: [bookingId], failed: [] }),
      refetch: async () => {},
    };
  };
  const filled = { room: 'r2', deposit: 150, consent: true, notes: 'Fasting since midnight' };

  const { Story } = defineMeta({
    title: 'Forms/BookingCustomFields',
    component: BookingCustomFields,
    tags: ['autodocs'],
    argTypes: { summary: { control: 'boolean' } },
    args: { bookingId: 'bk-1', summary: false },
  });
</script>

<Story name="Facts (editable)" args={{ customValues: store({ vals: filled }) }}>
  {#snippet template(args)}<div class="w-96"><BookingCustomFields {...args} /></div>{/snippet}
</Story>

<Story name="Facts (empty values)" args={{ customValues: store() }}>
  {#snippet template(args)}<div class="w-96"><BookingCustomFields {...args} /></div>{/snippet}
</Story>

<Story name="Facts (read only)" args={{ customValues: store({ vals: filled, canEdit: false }) }}>
  {#snippet template(args)}<div class="w-96"><BookingCustomFields {...args} /></div>{/snippet}
</Story>

<Story name="Summary line" args={{ summary: true, customValues: store({ vals: filled }) }}>
  {#snippet template(args)}<div class="w-96"><BookingCustomFields {...args} /></div>{/snippet}
</Story>

<Story name="Summary (nothing set, renders nothing)" args={{ summary: true, customValues: store() }}>
  {#snippet template(args)}<div class="w-96 border border-border"><BookingCustomFields {...args} /></div>{/snippet}
</Story>

<Story name="Not loaded yet (renders nothing)" args={{ customValues: store({ loaded: false }) }}>
  {#snippet template(args)}<div class="w-96 border border-border"><BookingCustomFields {...args} /></div>{/snippet}
</Story>

<Story name="Definitions refused (renders nothing)" args={{ customValues: store({ failed: true }) }}>
  {#snippet template(args)}<div class="w-96 border border-border"><BookingCustomFields {...args} /></div>{/snippet}
</Story>
