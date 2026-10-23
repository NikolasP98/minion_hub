import type { EvalReset } from './eval-protocol';
export const bootstrap = (globalThis as typeof globalThis & { __evalBootstrap?: EvalReset })
  .__evalBootstrap;
const host = {
  id: 'critical-host',
  name: 'Synthetic fixture gateway',
  url: 'ws://critical.invalid',
  lastConnectedAt: null,
};
export const page = $state({
  url: new URL(bootstrap?.sandbox ? 'http://127.0.0.1/sandbox' : 'http://127.0.0.1/home'),
  params: {},
  route: { id: '/(app)/home' },
  status: 200,
  error: null,
  form: null,
  state: {},
  data: {
    user: {
      id: 'fixture-user',
      role: bootstrap?.persona === 'reader' ? 'user' : 'admin',
      email: 'fixture@minion.test',
    },
    permissions: {
      permissions:
        bootstrap?.persona === 'reader'
          ? ['sandbox:view']
          : ['sandbox:view', 'sandbox:edit', 'scheduling:edit', 'scheduling:view'],
    },
    activeOrgKind: 'business',
    activeOrgId: 'fixture-org',
    orgAssignedHostId: host.id,
    hosts: { servers: [host], orgAssignedHostId: host.id, channels: [] },
    personalAgent: { agent: { agentId: 'fixture-agent', name: 'Fixture agent' } },
  },
});
export const navigating = null;
export const updated = { current: false, check: async () => false };
