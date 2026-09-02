<script lang="ts">
  import type { PageData } from './$types';
  import { CalendarPlus } from 'lucide-svelte';
  import { PageHeader, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import BookingCreateForm from '$lib/components/scheduling/BookingCreateForm.svelte';
  import * as m from '$lib/paraglide/messages';

  let { data }: { data: PageData } = $props();
  const returnTo = $derived(
    data.contact ? `/scheduling/bookings?contact=${data.contact.id}` : '/scheduling/bookings',
  );
</script>

<svelte:head><title>{m.pos_appt_new()} · {m.nav_scheduling()}</title></svelte:head>

<PageShell archetype="form" scroll="page" labelledBy="scheduling-booking-new-title">
  <PageHeader
    titleId="scheduling-booking-new-title"
    title={m.pos_appt_new()}
    subtitle={data.contact?.name ?? undefined}
  >
    {#snippet leading()}
      <CalendarPlus size={iconSizes.md} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>
  <PageBody padding="compact">
    <BookingCreateForm
      eventTypes={data.eventTypes}
      stockEnabled={data.stockEnabled}
      contact={data.contact}
      {returnTo}
    />
  </PageBody>
</PageShell>
