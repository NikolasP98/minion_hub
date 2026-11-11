<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { CUSTOM_PROPERTY_COLORS } from '$lib/tables/custom-properties';
  import BookingCustomFields from '$lib/components/scheduling/BookingCustomFields.svelte';
  import type { BookingCustomValues } from '$lib/components/scheduling/kit/booking-custom-values.svelte';
  import { createCustomPropertyManagerActions } from '$lib/components/data-table/custom-properties/api';
  import type {
    CustomPropertyDefinition,
    CustomPropertyRules,
    CustomPropertyType,
    CustomPropertyValue,
    CustomPropertyValueCell,
  } from '$lib/tables/custom-properties';

  // Plain-object stand-in for the `BookingCustomValues` store: the component only
  // reads `failed`, `values`, `bundle()`, `apply()` and `refetch()`.
  const ts = '2026-11-01T10:00:00.000Z';
  const def = (
    id: string,
    label: string,
    type: CustomPropertyType,
    rules: CustomPropertyRules,
    over: Partial<CustomPropertyDefinition> = {},
  ): CustomPropertyDefinition => ({
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
    def('room', 'Room', 'select', {
      type: 'select',
      options: [
        { id: 'r1', label: 'Room 1', color: CUSTOM_PROPERTY_COLORS[0], archivedAt: null },
        { id: 'r2', label: 'Room 2', color: CUSTOM_PROPERTY_COLORS[1], archivedAt: null },
      ],
    }),
    def('deposit', 'Deposit', 'number', { type: 'number', min: 0, max: null, precision: 2 }),
    def('consent', 'Consent signed', 'boolean', { type: 'boolean' }),
    def('notes', 'Prep notes', 'text', { type: 'text', maxLength: 500 }),
  ];
  const cell = (
    propertyId: string,
    recordId: string,
    value: CustomPropertyValue,
  ): CustomPropertyValueCell => ({
    propertyId,
    recordId,
    present: value !== null,
    value,
    effectiveValue: value,
    version: 1,
    updatedAt: ts,
  });
  const values = (
    bookingId: string,
    v: Record<string, CustomPropertyValue>,
  ): Record<string, Record<string, CustomPropertyValueCell>> => ({
    [bookingId]: Object.fromEntries(
      defs.map((d) => [d.id, cell(d.id, bookingId, v[d.id] ?? null)]),
    ),
  });
  const store = ({
    bookingId = 'bk-1',
    vals = {},
    canEdit = true,
    failed = false,
    loaded = true,
  }: {
    bookingId?: string;
    vals?: Record<string, CustomPropertyValue>;
    canEdit?: boolean;
    failed?: boolean;
    loaded?: boolean;
  } = {}): BookingCustomValues => {
    const cells = loaded ? values(bookingId, vals) : {};
    const editable = loaded ? { [bookingId]: canEdit } : {};
    return {
      defs,
      selectDefs: defs.filter((d) => d.type === 'select'),
      canManage: canEdit,
      failed,
      values: cells,
      editable,
      managerActions: createCustomPropertyManagerActions(),
      load: async () => {},
      setDefs: () => {},
      upsertDef: () => {},
      ensure: () => {},
      loaded: (id) => cells[id] !== undefined,
      refetch: async () => {},
      valueOf: (id, d) => {
        const v = cells[id]?.[d.id]?.effectiveValue;
        return typeof v === 'string' ? v : null;
      },
      apply: async () => ({ ok: [bookingId], failed: [] }),
      writes: () => [],
      bundle: () => ({
        definitions: defs,
        values: cells,
        recordAccess: loaded ? { [bookingId]: { canEdit } } : {},
        canManage: canEdit,
        canEdit,
      }),
    };
  };
  const filled = { room: 'r2', deposit: 150, consent: true, notes: 'Fasting since midnight' };

  const { Story } = defineMeta({
    title: 'Components/Forms/BookingCustomFields',
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

<Story
  name="Summary (nothing set, renders nothing)"
  args={{ summary: true, customValues: store() }}
>
  {#snippet template(args)}<div class="w-96 border border-border">
      <BookingCustomFields {...args} />
    </div>{/snippet}
</Story>

<Story name="Not loaded yet (renders nothing)" args={{ customValues: store({ loaded: false }) }}>
  {#snippet template(args)}<div class="w-96 border border-border">
      <BookingCustomFields {...args} />
    </div>{/snippet}
</Story>

<Story
  name="Definitions refused (renders nothing)"
  args={{ customValues: store({ failed: true }) }}
>
  {#snippet template(args)}<div class="w-96 border border-border">
      <BookingCustomFields {...args} />
    </div>{/snippet}
</Story>
