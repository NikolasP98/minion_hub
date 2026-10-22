export const page = $state({
  url: new URL('http://localhost/home'),
  params: {},
  route: { id: '/(app)/home' },
  state: {},
  data: {
    user: { id: 'actor-a', role: 'admin', email: 'fixture@example.test' },
    activeOrgId: 'org-a',
    personalAgent: { agent: { agentId: 'agent-a' } },
    permissions: { permissions: [] },
  },
});
