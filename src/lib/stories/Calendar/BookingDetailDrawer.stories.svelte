<script module lang="ts">
  import { defineMeta } from '@storybook/addon-svelte-csf';
  import { fn } from 'storybook/test';
  import BookingDetailDrawer from '$lib/components/scheduling/BookingDetailDrawer.svelte';

  // The drawer fetches `${apiBase}/${bookingId}` itself; Storybook serves no
  // API, so an open drawer shows its loading → error path. The filled state
  // cannot be driven by props.
  const { Story } = defineMeta({
    title: 'Calendar/BookingDetailDrawer',
    component: BookingDetailDrawer,
    tags: ['autodocs'],
    args: {
      bookingId: null,
      timeZone: 'America/Lima',
      mutationScope: 'org-demo',
      resources: [
        { id: 'r-ana', name: 'Ana Quispe' },
        { id: 'r-luis', name: 'Luis Fernández de la Torre' },
      ],
      canEdit: true,
      onclose: fn(),
      onchanged: fn(),
      onnavigate: fn(),
      onpay: fn(),
    },
  });
</script>

<Story name="Closed" />
<Story name="Open (fetch fails)" args={{ bookingId: 'b-404' }} />
<Story name="Open, read-only" args={{ bookingId: 'b-404', canEdit: false, onpay: undefined }} />

<!-- Responsive: the drawer takes the full width on a phone; the actions row stacks below a 30rem container. -->
<Story name="Open (fetch fails) · Phone" args={{ bookingId: 'b-404' }} globals={{ viewport: { value: 'phone', isRotated: false } }} />
