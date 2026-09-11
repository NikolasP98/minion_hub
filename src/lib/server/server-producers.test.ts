import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  capture: vi.fn(),
  write: vi.fn(),
  agents: vi.fn(),
  install: vi.fn(),
  save: vi.fn(),
  mark: vi.fn(),
  run: vi.fn(),
  catalog: vi.fn(),
  insert: vi.fn(),
  safeUrl: vi.fn(),
}));
vi.mock('$app/environment', () => ({ building: false }));
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_POSTHOG_KEY: 'synthetic-test-key' } }));
vi.mock('posthog-node', () => ({
  PostHog: class {
    capture = f.capture;
    on = vi.fn();
    flush = vi.fn();
  },
}));
vi.mock('@minion-stack/db/schema', () => ({ servers: {} }));
vi.mock('$server/db/utils', () => ({ nowMs: () => 1 }));
vi.mock('$server/services/server.service', () => ({ upsertServer: f.write }));
vi.mock('$server/services/hosts.service', () => ({ loadHostsForUser: vi.fn() }));
vi.mock('$server/auth/tenant-ctx', () => ({
  getOrCreateTenantCtx: async () => ({ tenantId: 'org_1' }),
  getTenantCtx: async () => ({
    tenantId: 'org_1',
    db: {
      insert: () => ({ values: (row: unknown) => ({ onConflictDoNothing: () => f.insert(row) }) }),
    },
  }),
}));
vi.mock('$server/auth/core-ctx', () => ({
  getCoreCtx: async () => ({ tenantId: 'org_1', db: {} }),
  requireCoreCtx: async () => ({ tenantId: 'org_1', db: {} }),
}));
vi.mock('$server/services/marketplace.service', () => ({
  getAgentWithFiles: f.catalog,
  recordInstall: f.install,
}));
vi.mock('$server/services/agent.service', () => ({ upsertAgents: f.agents }));
vi.mock('$server/services/ssrf-guard', () => ({
  assertSafeUrl: f.safeUrl,
  SsrfBlockedError: class extends Error {},
}));
vi.mock('$server/services/provision.service', () => ({
  PHASES: [{ id: '00' }, { id: '20' }],
  getProvisionConfig: async () => ({ sshHost: 'private-ssh-sentinel', phaseStatuses: {} }),
  runSetupPhase: f.run,
  savePhaseStatuses: f.save,
  markProvisionRun: f.mark,
}));
import { POST as addServer } from '../../routes/api/servers/+server';
import { POST as provision } from '../../routes/api/servers/[id]/provision/run/+server';
import { POST as install } from '../../routes/api/marketplace/install/+server';

const secret = 'ghp_privateCredentialSentinel';
const locals = {
  user: { id: 'usr_1', role: 'admin', email: 'private-person@example.test' },
  orgId: 'org_1',
  tenantCtx: { tenantId: 'org_1' },
};
function event(body: unknown, route: string, extra: Record<string, unknown> = {}) {
  return {
    locals,
    request: new Request('http://fixture.invalid/resolved-private-sentinel', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    route: { id: route },
    params: { id: 'private-resource-sentinel' },
    ...extra,
  } as unknown as Parameters<typeof addServer>[0];
}
const settle = async () => {
  await vi.dynamicImportSettled();
  await new Promise<void>((r) => setImmediate(r));
};
beforeEach(() => {
  vi.clearAllMocks();
  f.capture.mockReset();
  f.write.mockResolvedValue('private-resource-sentinel');
  f.catalog.mockResolvedValue({
    id: 'private-agent-sentinel',
    name: 'private-name-sentinel',
    category: 'private-category-sentinel',
    version: 'private-version-sentinel',
    tags: '[]',
  });
  f.run.mockImplementation(
    () =>
      new ReadableStream<string>({
        start(c) {
          c.enqueue('| Phase 20\n[Process exited with code 0]');
          c.close();
        },
      }),
  );
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
  await settle();
  vi.restoreAllMocks();
});

describe('actual server producer business/telemetry separation', () => {
  it('adds a server without sending names, URLs or request-body credentials to telemetry/logs', async () => {
    const body = {
      name: 'private-name-sentinel',
      url: 'https://private-host.invalid',
      token: secret,
    };
    const response = await addServer(event(body, '/api/servers'));
    expect(await response.json()).toEqual({ ok: true });
    expect(f.write).toHaveBeenCalledOnce();
    await settle();
    expect(f.capture).toHaveBeenCalledOnce();
    const wire = JSON.stringify(f.capture.mock.calls);
    for (const value of Object.values(body)) expect(wire).not.toContain(value);
    expect(wire).toContain('server_added');
    expect(f.capture.mock.calls[0][0].properties.server_id).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(f.capture.mock.calls[0][0].distinctId).toBe('org:org_1');
    expect(
      JSON.stringify([
        vi.mocked(console.log).mock.calls,
        vi.mocked(console.warn).mock.calls,
        vi.mocked(console.error).mock.calls,
      ]),
    ).not.toContain(secret);
  });
  it('keeps successful server writes successful when capture throws', async () => {
    f.capture.mockImplementation(() => {
      throw new Error('private-telemetry-error');
    });
    const response = await addServer(
      event({ name: 'server', url: 'https://fixture.invalid' }, '/api/servers'),
    );
    expect(response.status).toBe(200);
    expect(f.write).toHaveBeenCalledOnce();
  });
  it('preserves provisioning SSE completion and stores statuses without exporting SSH host', async () => {
    const response = await provision(event({ startFrom: '20' }, '/api/servers/[id]/provision/run'));
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await response.text()).toContain('event: done');
    expect(f.save).toHaveBeenCalledOnce();
    expect(f.mark).toHaveBeenCalledOnce();
    await settle();
    expect(f.capture).toHaveBeenCalledOnce();
    const wire = JSON.stringify(f.capture.mock.calls);
    expect(wire).not.toContain('private-ssh-sentinel');
    expect(wire).not.toContain('private-resource-sentinel');
    expect(f.capture.mock.calls[0][0].properties.start_from).toBe('20');
  });
  it('starts provisioning despite telemetry failure and omits unknown telemetry phase strings', async () => {
    f.capture.mockImplementation(() => {
      throw new Error('private-telemetry-error');
    });
    const response = await provision(
      event({ startFrom: secret }, '/api/servers/[id]/provision/run'),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('event: done');
    expect(f.run).toHaveBeenCalledOnce();
    await settle();
    expect(JSON.stringify(f.capture.mock.calls)).not.toContain(secret);
  });
  it('preserves marketplace gateway files while omitting catalog free text and raw resource IDs', async () => {
    const response = await install(
      event(
        { agentId: 'private-agent-sentinel', serverId: 'private-resource-sentinel' },
        '/api/marketplace/install',
      ),
    );
    expect((await response.json()).files['agent.json']).toContain('private-name-sentinel');
    expect(f.agents).toHaveBeenCalledOnce();
    expect(f.install).toHaveBeenCalledOnce();
    await settle();
    const wire = JSON.stringify(f.capture.mock.calls);
    for (const value of [
      'private-agent-sentinel',
      'private-resource-sentinel',
      'private-name-sentinel',
      'private-category-sentinel',
      'private-version-sentinel',
    ])
      expect(wire).not.toContain(value);
    expect(wire).toContain('agent_installed_from_marketplace');
  });
  it('returns marketplace files after committed writes even when telemetry fails', async () => {
    f.capture.mockImplementation(() => {
      throw new Error('private-telemetry-error');
    });
    const response = await install(
      event({ agentId: 'agent-1', serverId: 'server-1' }, '/api/marketplace/install'),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
    expect(f.install).toHaveBeenCalledOnce();
  });
  it('retains authentication/admin refusals before mutations', async () => {
    await expect(addServer(event({}, '/api/servers', { locals: {} }))).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      provision(
        event({}, '/api/servers/[id]/provision/run', {
          locals: { user: { id: 'usr_1', role: 'user' } },
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(f.write).not.toHaveBeenCalled();
    expect(f.run).not.toHaveBeenCalled();
  });
});

it('never logs the server creation request body or credential on failure either', async () => {
  f.safeUrl.mockRejectedValueOnce(new Error('private-URL-error-' + secret));
  const response = await addServer(
    event(
      { name: 'private-name-sentinel', url: 'https://private-host.invalid', token: secret },
      '/api/servers',
    ),
  );
  expect(response.status).toBe(500);
  expect(f.write).not.toHaveBeenCalled();
  const logs = JSON.stringify([
    vi.mocked(console.log).mock.calls,
    vi.mocked(console.warn).mock.calls,
    vi.mocked(console.error).mock.calls,
  ]);
  for (const value of [
    secret,
    'private-person@example.test',
    'private-name-sentinel',
    'private-host.invalid',
  ])
    expect(logs).not.toContain(value);
});

it.each([
  ['server', addServer, '/api/servers', { name: 'server', url: 'https://fixture.invalid' }],
  ['provision', provision, '/api/servers/[id]/provision/run', { startFrom: '20' }],
  [
    'marketplace',
    install,
    '/api/marketplace/install',
    { agentId: 'agent-1', serverId: 'server-1' },
  ],
] as const)(
  'does not change %s outcomes if telemetry metadata access throws',
  async (_name, handler, route, body) => {
    const ev = event(body, route);
    Object.defineProperty(ev.request, 'headers', {
      get() {
        throw new Error('private-metadata-sentinel');
      },
    });
    const response = await handler(ev);
    expect(response.status).toBe(200);
    await response.text();
    await settle();
    expect(f.capture).not.toHaveBeenCalled();
  },
);
