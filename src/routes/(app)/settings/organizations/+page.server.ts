import type { PageServerLoad } from './$types';
import { requireAdmin } from '$server/auth/authorize';
import { listAllOrganizationsWithMemberCounts } from '$server/services/organizations.service';
import { supabaseAdmin } from '$server/supabase';

export const load: PageServerLoad = async ({ locals, depends }) => {
  requireAdmin(locals);
  depends('settings:organizations');
  const [organizations, profilesResult] = await Promise.all([
    listAllOrganizationsWithMemberCounts(),
    supabaseAdmin()
      .from('profiles')
      .select('id, email, display_name')
      .order('display_name', { nullsFirst: false }),
  ]);
  return {
    organizations,
    profiles: (profilesResult.data ?? []) as Array<{
      id: string;
      email: string | null;
      display_name: string | null;
    }>,
  };
};
