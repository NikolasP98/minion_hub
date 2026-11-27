<script lang="ts">
  import { page } from '$app/state';
  import DataTable, { type DataColumn } from '$lib/components/data-table/DataTable.svelte';
  import BookingCalendar from '$lib/components/scheduling/BookingCalendar.svelte';
  import type { CalendarBooking } from '$lib/components/scheduling/calendar-window';
  import BoardView from '$lib/components/data-view/BoardView.svelte';
  import Picker, { type PickerColumn } from '$lib/components/ui/Picker.svelte';
  import CommandPalette from '$lib/components/layout/CommandPalette.svelte';
  import { Button } from '$lib/components/ui';
  import { togglePalette } from '$lib/state/ui/command-palette.svelte';

  // One widget per page load: /?w=datatable | calendar | board | picker | palette.
  const widget = new URLSearchParams(location.search).get('w');

  // The palette lists the routes this user may open (`canViewPath` reads `page.data`).
  Object.assign(page.data, {
    user: { id: 'u-1', role: 'admin', email: 'ana@example.com', displayName: 'Ana' },
    permissions: { permissions: ['settings:manage', 'users:manage'], roles: ['owner'] },
    activeOrgKind: 'business',
  });

  // --- DataTable ---------------------------------------------------------------------------
  type Product = { id: string; code: string; name: string; status: string; qty: number };
  const STATUS = ['active', 'paused', 'archived'].map((s) => ({
    value: s,
    label: s[0].toUpperCase() + s.slice(1),
  }));
  const productNames = ['Oak', 'Hydrating facial serum', 'Pine', 'Consultation', 'Lamp'];
  const products: Product[] = productNames.map((name, i) => ({
    id: `row-${i + 1}`,
    code: `SKU-${String(i + 1).padStart(4, '0')}`,
    name,
    status: STATUS[i % 3].value,
    qty: (i * 37) % 50,
  }));
  const productColumns: DataColumn<Product>[] = [
    { key: 'code', label: 'Code', width: 110 },
    { key: 'name', label: 'Name', fill: true, width: 220 },
    { key: 'status', label: 'Status', type: 'select', options: () => STATUS, width: 120 },
    { key: 'qty', label: 'Qty', type: 'number', align: 'right', width: 90 },
  ];

  // --- Booking calendar: the week of Monday 12 January 2026, Lima (UTC-5, no DST) ----------
  const resources = [
    { id: 'r-ana', name: 'Ana Quispe', color: 'var(--color-info-border)' },
    { id: 'r-luis', name: 'Luis Torres', color: 'var(--color-success-border)' },
  ];
  const eventTypes = [
    { id: 'et-cons', title: 'Consultation', color: null, kindId: 'k-clinic' },
    { id: 'et-fup', title: 'Follow-up', color: null, kindId: 'k-clinic' },
  ];
  const kinds = [
    { id: 'k-clinic', name: 'Clinical', color: 'var(--color-info-border)', isDefault: true },
  ];
  /** `hh:mm` Lima time on a January 2026 day → UTC ISO instant. */
  const at = (day: number, hhmm: string, plusMin = 0) => {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(Date.UTC(2026, 0, day, h + 5, m + plusMin)).toISOString();
  };
  const booking = (
    id: string,
    day: number,
    start: string,
    minutes: number,
    patch: Partial<CalendarBooking> = {},
  ): CalendarBooking => ({
    id,
    resourceId: 'r-ana',
    eventTypeId: 'et-cons',
    start: at(day, start),
    end: at(day, start, minutes),
    status: 'accepted',
    attendeeName: 'Carla Mendoza',
    tags: [],
    categoryColor: null,
    ...patch,
  });
  const bookings: CalendarBooking[] = [
    booking('b1', 12, '09:00', 45),
    booking('b2', 12, '09:30', 60, {
      resourceId: 'r-luis',
      attendeeName: 'Jorge Rojas',
      status: 'pending',
    }),
    booking('b3', 13, '14:00', 30, { attendeeName: 'Li Wong', eventTypeId: 'et-fup' }),
    booking('b4', 14, '11:00', 45, { attendeeName: 'Pedro Castillo', status: 'no_show' }),
    booking('b5', 15, '16:00', 60, { resourceId: 'r-luis', attendeeName: null }),
    booking('b6', 16, '12:00', 45, { attendeeName: 'Paid visit', paid: true }),
  ];
  const noop = () => {};

  // --- BoardView ---------------------------------------------------------------------------
  type Deal = { id: string; title: string; client: string; stage: string | null };
  const stages = [
    { id: 'new', label: 'New' },
    { id: 'contacted', label: 'Contacted' },
    { id: 'won', label: 'Won', color: 'var(--color-success)' },
  ];
  const deals: Deal[] = [
    { id: '1', title: 'Website redesign', client: 'Garcia Studio', stage: 'new' },
    { id: '2', title: 'Quarterly SEO retainer', client: 'Northwind', stage: 'new' },
    { id: '3', title: 'Brand guidelines', client: 'Lumen', stage: 'contacted' },
    { id: '4', title: 'Logo', client: 'Pine', stage: 'won' },
    { id: '5', title: 'Unassigned lead', client: 'Unknown', stage: null },
  ];

  // --- Picker ------------------------------------------------------------------------------
  type Service = { id: string; name: string; sku: string; price: string };
  const serviceNames = ['Keratin treatment', 'Haircut', 'Beard trim', 'Hair colour', 'Manicure'];
  const services: Service[] = serviceNames.map((name, i) => ({
    id: `p-${i + 1}`,
    name,
    sku: `SKU-${1000 + i}`,
    price: ((i + 1) * 17.5).toFixed(2),
  }));
  const serviceColumns: PickerColumn<Service>[] = [
    { key: 'name', label: 'Name', emphasis: 'primary', searchable: true, priority: 1 },
    { key: 'sku', label: 'SKU', searchable: true, priority: 2 },
    { key: 'price', label: 'Price', align: 'right', priority: 3, value: (r) => `S/ ${r.price}` },
  ];
  let pickerOpen = $state(false);
</script>

{#snippet dealCard(deal: Deal)}
  <div class="flex flex-col gap-1">
    <span class="text-sm font-medium">{deal.title}</span>
    <span class="text-xs text-muted-foreground">{deal.client}</span>
  </div>
{/snippet}

<main data-widget={widget}>
  {#if widget === 'datatable'}
    <DataTable
      data={products}
      columns={productColumns}
      getRowId={(row) => row.id}
      ariaLabel="Products"
      height="28rem"
      onRowClick={noop}
    />
  {:else if widget === 'calendar'}
    <div style="height: 80vh; display: flex; flex-direction: column;">
      <BookingCalendar
        view="week"
        date="2026-01-14"
        timeZone="America/Lima"
        mutationScope="org-fixture"
        {bookings}
        {resources}
        {eventTypes}
        {kinds}
        tagOptions={[]}
        onview={noop}
        ondate={noop}
        onrange={noop}
        onopen={noop}
        onselect={noop}
        onslot={noop}
        onmove={noop}
      />
    </div>
  {:else if widget === 'board'}
    <div style="height: 28rem">
      <BoardView
        columns={stages}
        rows={deals}
        columnOf={(deal) => deal.stage}
        rowKey={(deal) => deal.id}
        rowLabel={(deal) => deal.title}
        onopen={noop}
        card={dealCard}
      />
    </div>
  {:else if widget === 'picker'}
    <Button onclick={() => (pickerOpen = true)}>Open picker</Button>
    <Picker
      bind:open={pickerOpen}
      title="Add a service"
      columns={serviceColumns}
      rows={services}
      getRowId={(row) => row.id}
      onPick={noop}
    />
  {:else if widget === 'palette'}
    <Button onclick={() => togglePalette()}>Open palette</Button>
    <CommandPalette />
  {/if}
</main>
