import { redirect } from '@sveltejs/kit';

// /tools is now the Tools tab of Capabilities. Keep the path working for
// bookmarks and external links by redirecting to the unified page.
export const load = () => {
  throw redirect(307, '/capabilities?tab=tools');
};
