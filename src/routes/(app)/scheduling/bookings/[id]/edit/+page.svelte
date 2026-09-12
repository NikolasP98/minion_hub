<script lang="ts">
  import type { PageData } from './$types';
  import { CalendarClock } from 'lucide-svelte';
  import { PageHeader, iconSizes } from '$lib/components/ui';
  import { PageBody, PageShell } from '$lib/components/ui/foundations';
  import BookingEditForm from '$lib/components/scheduling/BookingEditForm.svelte';
  import * as m from '$lib/paraglide/messages';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{m.sched_edit_booking()} · {m.nav_scheduling()}</title></svelte:head>

<PageShell archetype="form" scroll="page" labelledBy="scheduling-booking-edit-title">
  <PageHeader titleId="scheduling-booking-edit-title" title={m.sched_edit_booking()}>
    {#snippet leading()}
      <CalendarClock size={iconSizes.md} class="text-accent shrink-0" />
    {/snippet}
  </PageHeader>
  <PageBody padding="compact">
    <BookingEditForm
      booking={data.booking}
      eventTypes={data.eventTypes}
      resources={data.resources}
      kinds={data.kinds}
      tags={data.tags}
      currentTagIds={data.currentTagIds}
    />
  </PageBody>
</PageShell>
