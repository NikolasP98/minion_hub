import { env } from '$env/dynamic/private';
import { isDevQaLoginAvailable } from '$server/dev-backend';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
  return {
    googleEnabled: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    qaLoginAvailable: isDevQaLoginAvailable(locals, url),
  };
};
