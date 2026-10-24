<script lang="ts">
  import type { PageData as LoadedPageData } from './$types';
  import type { Granted } from '$lib/permissions';
  import { page } from '$app/state';
  import * as m from '$lib/paraglide/messages';
  import BookingsView from '$lib/components/scheduling/BookingsView.svelte';

  type PageData = Granted<LoadedPageData['scheduling']>;
  let { data }: { data: PageData } = $props();

  // Sales orders are business-only kind-gated (S3/WP1 R6) — hide the
  // per-booking "Create sales order" action for personal orgs.
  const isPersonal = $derived(page.data.activeOrgKind === 'personal');
  const capabilities = $derived({ createSalesOrder: !isPersonal });
</script>

<svelte:head><title>{m.sched_bookings_title()} · {m.nav_scheduling()}</title></svelte:head>

<BookingsView
  {data}
  {capabilities}
  invalidateKey="scheduling:data"
  labelNamespace="scheduling"
  titleId="scheduling-bookings-title"
  surfaceClass="scheduling-bookings-surface"
/>
