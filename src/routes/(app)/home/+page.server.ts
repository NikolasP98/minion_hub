import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The assistant screen moved to /chat (spec 046 S3); old bookmarks keep working.
export const load: PageServerLoad = async () => {
  throw redirect(308, '/chat');
};
