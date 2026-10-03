import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { supabaseAdmin } from '$server/supabase';

/** The public entrypoint has one configured destination, never an alphabetical fallback. */
export async function resolveJoinRequestTarget(): Promise<{ id: string; name: string }> {
  const slug = env.PUBLIC_DEFAULT_ORG_SLUG?.trim();
  let query = supabaseAdmin().from('organizations').select('id,name').eq('status', 'active');
  if (slug) query = query.eq('slug', slug);
  const { data, error: queryError } = await query.limit(2);
  if (queryError || !data || data.length !== 1 || typeof data[0].id !== 'string') {
    throw error(
      503,
      'Access requests are unavailable for this workspace. Please use an invite link.',
    );
  }
  return {
    id: data[0].id,
    name: typeof data[0].name === 'string' ? data[0].name.slice(0, 160) : 'Workspace',
  };
}
