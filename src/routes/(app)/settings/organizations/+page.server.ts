import type { PageServerLoad } from './$types';
import { requireAdmin } from '$server/auth/authorize';
import { listAllOrganizationsWithMemberCounts } from '$server/services/organizations.service';
import { supabaseAdmin } from '$server/supabase';

export const load: PageServerLoad = async ({ locals, depends }) => {
  requireAdmin(locals);
  depends('settings:organizations');
  const [organizations, profilesResult, runsResult] = await Promise.all([
    listAllOrganizationsWithMemberCounts(),
    supabaseAdmin()
      .from('profiles')
      .select('id, email, display_name')
      .order('display_name', { nullsFirst: false }),
    supabaseAdmin()
      .from('org_provision_runs')
      .select('org_id, ok, steps, started_at, completed_at'),
  ]);
  const savedTraces: Record<
    string,
    { ok: boolean; organization: null; steps: unknown; startedAt: string; completedAt: string }
  > = {};
  for (const run of (runsResult.data ?? []) as Array<{
    org_id: string;
    ok: boolean;
    steps: unknown;
    started_at: string;
    completed_at: string;
  }>) {
    savedTraces[run.org_id] = {
      ok: run.ok,
      organization: null,
      steps: run.steps,
      startedAt: run.started_at,
      completedAt: run.completed_at,
    };
  }
  return {
    organizations,
    savedTraces,
    profiles: (profilesResult.data ?? []) as Array<{
      id: string;
      email: string | null;
      display_name: string | null;
    }>,
  };
};
