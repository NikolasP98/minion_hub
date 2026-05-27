import { redirect } from '@sveltejs/kit';
import { pluginsUiList } from '$lib/server/gateway-rpc';
import { shouldBlockFlowEditor } from '$lib/server/flows-gate';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  try {
    const entries = await pluginsUiList(locals.user?.supabaseId);
    if (shouldBlockFlowEditor(entries)) {
      throw redirect(307, '/workforce');
    }
  } catch (err) {
    // redirect() throws a Response with status+location — rethrow it. Any OTHER
    // error (gateway unreachable / no flows entry) ⇒ fail open: allow access.
    if (err && typeof err === 'object' && 'status' in err && 'location' in err) throw err;
  }
  return {};
};
