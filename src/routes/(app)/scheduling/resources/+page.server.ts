import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** People management moved to /team (hub-team-hr-module spec S4); rooms & equipment live on /team?tab=resources. */
export const load: PageServerLoad = () => {
  throw redirect(307, '/team?tab=people');
};
