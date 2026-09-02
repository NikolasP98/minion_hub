import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { loadBookingsView } from '$server/scheduling/load-bookings-view';

export const load: PageServerLoad = async ({ locals, depends, url }) => {
  // Legacy deep link (`?new=1[&contact=]`) → the in-page booking form.
  if (url.searchParams.get('new') === '1') {
    const contact = url.searchParams.get('contact');
    redirect(
      302,
      contact ? `/scheduling/bookings/new?contact=${contact}` : '/scheduling/bookings/new',
    );
  }
  return loadBookingsView(
    { locals, depends, url },
    {
      dependsKey: 'scheduling:data',
      // Rolling window: a month back for follow-ups, a quarter ahead for the book.
      window: { beforeDays: 30, afterDays: 90 },
      limit: 500,
      contactScope: true,
    },
  );
};
