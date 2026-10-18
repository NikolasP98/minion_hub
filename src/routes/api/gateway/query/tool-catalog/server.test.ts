import { beforeEach, describe, expect, it, vi } from 'vitest';
const resolve = vi.hoisted(() => vi.fn());
const states = vi.hoisted(() => vi.fn());
vi.mock('$server/services/modules.service', () => ({ listModuleStates: states }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({}) }));
beforeEach(() => {
  states.mockResolvedValue({});
});
vi.mock('$server/auth/assistant-principal', () => ({ resolveAssistantPrincipal: resolve }));
import { GET } from './+server';
import { ASSISTANT_TOOL_DECLARATIONS } from '$server/services/assistant-tool-catalog';
import { MODULE_VARS } from '$server/services/hub-module-vars';
const call = () =>
  GET({
    locals: {},
    url: new URL('https://hub.test/api/gateway/query/tool-catalog?agentId=personal-a'),
  } as never);

describe('current principal tool catalog', () => {
  it('serves the executable contract with stable revisions and shared references', async () => {
    resolve.mockResolvedValue({
      principalId: 'profile-a',
      orgId: 'org-a',
      capabilities: {
        can: (module: string, action: string) => module === 'pos' && action === 'view',
      },
    });
    const response = await call();
    const catalog = await response.json();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(catalog).toMatchObject({ schemaVersion: 1, principalId: 'profile-a', orgId: 'org-a' });
    expect(catalog.tools).toHaveLength(1);
    expect(catalog.tools[0]).toMatchObject({
      name: 'catalog_query',
      method: 'GET',
      permission: { module: 'pos', action: 'view' },
    });
    expect(catalog.tools[0].contractRevision).toMatch(/^[a-f0-9]{64}$/);
    expect((await (await call()).json()).revision).toBe(catalog.revision);
    expect(MODULE_VARS.find((ref) => ref.path === catalog.tools[0].path)).toMatchObject({
      contractRevision: catalog.tools[0].contractRevision,
      inputSchema: catalog.tools[0].inputSchema,
      referenceOnly: true,
    });
  });
  it('does not advertise tools from a disabled organization module', async () => {
    resolve.mockResolvedValue({
      principalId: 'profile-a',
      orgId: 'org-a',
      capabilities: { can: () => true },
    });
    states.mockResolvedValue({ pos: false });
    expect((await (await call()).json()).tools).toEqual([]);
    expect(states).toHaveBeenCalledWith({ db: {}, tenantId: 'org-a', profileId: 'profile-a' });
  });
  it('withdraws retired declarations from discovery', async () => {
    resolve.mockResolvedValue({
      principalId: 'profile-a',
      orgId: 'org-a',
      capabilities: { can: () => true },
    });
    const tool = ASSISTANT_TOOL_DECLARATIONS[0];
    tool.lifecycle = 'retired';
    try {
      expect((await (await call()).json()).tools).toEqual([]);
    } finally {
      tool.lifecycle = 'active';
    }
  });
  it('does not advertise a denied capability and never falls back on resolution failure', async () => {
    resolve.mockResolvedValue({
      principalId: 'profile-b',
      orgId: 'org-b',
      capabilities: { can: () => false },
    });
    expect((await (await call()).json()).tools).toEqual([]);
    resolve.mockRejectedValue({ status: 403 });
    await expect(call()).rejects.toMatchObject({ status: 403 });
  });
});
