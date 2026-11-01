import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The assistant settings moved to /chat/settings (spec 046 S3).
export const load: PageServerLoad = async () => {
  throw redirect(308, '/chat/settings');
};
