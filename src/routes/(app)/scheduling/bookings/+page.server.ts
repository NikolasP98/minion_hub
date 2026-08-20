import type { PageServerLoad } from './$types';
import { loadBookingsView } from '$server/scheduling/load-bookings-view';

export const load: PageServerLoad = async ({ locals, depends, url }) =>
  loadBookingsView(
    { locals, depends, url },
    {
      dependsKey: 'scheduling:data',
      // Rolling window: a month back for follow-ups, a quarter ahead for the book.
      window: { beforeDays: 30, afterDays: 90 },
      limit: 500,
      contactScope: true,
    },
  );
