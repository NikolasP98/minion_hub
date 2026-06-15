import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
  const reason = event.url.searchParams.get('reason');
  return { reason };
};
