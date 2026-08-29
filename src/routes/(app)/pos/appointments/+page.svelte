<script lang="ts">
  import type { PageData } from './$types';
  import { CalendarDays } from 'lucide-svelte';
  import { goto } from '$lib/navigation';
  import { page } from '$app/state';
  import { iconSizes } from '$lib/components/ui';
  import * as m from '$lib/paraglide/messages';
  import { canAct } from '$lib/access/can.svelte';
  import BookingsView from '$lib/components/scheduling/BookingsView.svelte';
  import CustomerPicker from '$lib/components/pos/CustomerPicker.svelte';
  import type {
    BookingCustomerControl,
    BookingsViewBooking,
  } from '$lib/components/scheduling/bookings-view';
  import { chargeHandoff, chargeStorageKey } from './charge-handoff';
  // Surface skin for the classes this route forwards into `Button` primitives
  // through `surfaceClass`. It cannot be scoped component CSS (the elements are
  // rendered by `Button`, in its own scope) and it must not be shared with
  // `/scheduling/bookings`, which renders the same view unskinned.
  import './appointments-surface.css';

  // TODO(handoff): minion-meta specs/2026-08-17-hub-pos-appointments-fork-spec.md
  // frontmatter `reconcile_ignore_reason` still says "Slice 3 remains in open
  // draft PR #137" — #137 is unrelated CRM work; this route collapse (PR #198)
  // is the actual Slice 3. Needs a dev-branch update pointing at #198 and
  // noting Slice 4 (route-contract/count/smoke closure) is still open.
  // proposals/handoff-minion-meta-171406302.md

  let { data }: { data: PageData } = $props();

  // The front-desk day book: agenda grouping, walk-in staff overrides, and the
  // booking→ticket hand-off. No "Create sales order" — this fork never offered
  // it, and adding it here would newly expose Sales inside POS.
  //
  // PATCH/complete live under /api/scheduling → gated centrally by
  // scheduling:edit (the shared view checks that itself); the charge hand-off
  // writes a POS ticket, so it gates on pos:edit.
  const capabilities = $derived({
    createSalesOrder: false,
    chargeToPos: canAct('pos', 'edit'),
    dayAgenda: true,
    staffOverride: true,
  });

  /** Party-spine link the picker resolves; the booking call never sends it. */
  let partyId = $state<string | null>(null);

  function charge(booking: BookingsViewBooking) {
    localStorage.setItem(
      chargeStorageKey(page.data.activeOrgId),
      JSON.stringify(chargeHandoff(booking, data.eventTypes)),
    );
    goto('/pos/sell');
  }
</script>

<svelte:head><title>{m.pos_nav_appointments()} · {m.nav_pos()}</title></svelte:head>

<BookingsView
  {data}
  {capabilities}
  invalidateKey="pos:appointments"
  labelNamespace="pos"
  titleId="pos-appointments-title"
  surfaceClass="pos-appointments-surface"
  onCharge={charge}
>
  {#snippet leadingIcon()}
    <CalendarDays size={iconSizes.md} class="text-accent shrink-0" />
  {/snippet}
  {#snippet customerField(customer: BookingCustomerControl)}
    <CustomerPicker
      bind:partyId
      bind:customerName={
        () => customer.name,
        (v) => {
          if (!v) partyId = null;
          customer.setCustomer({ name: v });
        }
      }
      bind:phone={() => customer.phone, (v) => customer.setCustomer({ phone: v })}
    />
    {#if !customer.name}
      <p class="t-caption">{m.sched_book_find_client_ph()}</p>
    {/if}
  {/snippet}
</BookingsView>
