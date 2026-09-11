// Fixture stub for $app/state. `page.data` carries the synthetic authenticated
// identity the components read through `canAct`/`canClient`.
export const page = {
  url: new URL('http://127.0.0.1/en/fixture'),
  params: {},
  route: { id: '/(app)/fixture' },
  status: 200,
  error: null,
  form: null,
  state: {},
  data: {
    user: { id: 'fixture-user', role: 'admin', email: 'fixture@minion.test' },
    permissions: { permissions: ['scheduling:edit', 'scheduling:view'] },
    activeOrgKind: 'business',
    personalAgent: { agent: { agentId: 'fixture-agent', name: 'Fixture agent' } },
  },
};
export const navigating = null;
export const updated = { current: false, check: async () => false };
