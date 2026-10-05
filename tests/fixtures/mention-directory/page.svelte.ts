export const ACTOR = '10000000-0000-4000-8000-000000000001';
export const PERSON = '10000000-0000-4000-8000-000000000002';
export const ORG_A = '20000000-0000-4000-8000-000000000001';
export const ORG_B = '20000000-0000-4000-8000-000000000002';

/** Synthetic identity only. Shape matches the actual authenticated app layout. */
export const page = $state({
  data: {
    user: { id: ACTOR, supabaseId: ACTOR, email: 'fixture@example.test', role: 'user' },
    activeOrgId: ORG_A,
  },
});
