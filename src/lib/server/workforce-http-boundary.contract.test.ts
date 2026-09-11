import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { inspect } from 'node:util';
import path from 'node:path';
import * as transport from '@minion-stack/workforce-client';
import * as identity from '@minion-stack/workforce-client/identity-jwt';
import { GET as intakeStatus } from '../../routes/api/workforce/factory-intake/[id]/+server';
import { POST as intakeCreate } from '../../routes/api/workforce/factory-intake/+server';
import { load as activityLoad } from '../../routes/(app)/workforce/activity/+page.server';
import { load as inboxLoad } from '../../routes/(app)/workforce/inbox/+page.server';
import { load as layoutLoad } from '../../routes/(app)/workforce/+layout.server';
import { ensureWorkforceCompany } from './workforce-company';

const fixtures = vi.hoisted(() => ({
  env: { WORKFORCE_INTERNAL_URL: 'http://workforce.test' },
  organization: vi.fn(async () => ({ data: { name: 'Test org' } })),
}));
vi.mock('$env/dynamic/private', () => ({ env: fixtures.env }));
vi.mock('./workforce-identity', () => ({
  mintWorkforceIdentity: vi.fn(async () => 'synthetic-jwt'),
}));
vi.mock('$server/config/urls', () => ({ hubBaseUrl: () => 'https://hub.example.test' }));
vi.mock('$server/supabase', () => ({
  supabaseAdmin: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: fixtures.organization }) }) }),
  }),
}));

const mode = process.env.MINION_QC_WORKFORCE_MODE ?? 'installed';
const candidate = mode === 'candidate';
function event(urlPath = '/workforce/activity', method = 'GET', signal?: AbortSignal) {
  const url = new URL(urlPath, 'https://hub.example.test');
  return {
    request: new Request(url, {
      method,
      signal,
      ...(method === 'POST'
        ? { body: JSON.stringify({ request: 'Synthetic factory request' }) }
        : {}),
    }),
    url,
    params: { id: 'intake-id' },
    locals: {
      user: { id: 'actor' },
      orgId: 'org-qc',
      workforceIdentity: { token: 'TOKEN-CANARY', companyId: 'org-qc', userId: 'actor' },
    },
    depends: vi.fn(),
    parent: async () => ({ companyId: 'org-qc', workforceAvailable: true }),
  };
}
beforeEach(() => {
  fixtures.organization.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected synthetic fetch');
    }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe(`actual Workforce consumer boundary (${mode})`, () => {
  it('records exact package client bytes and preserves installed identity-jwt subpath', async () => {
    expect(['candidate', 'installed']).toContain(mode);
    const hub = process.cwd();
    const installed = path.join(hub, 'node_modules/@minion-stack/workforce-client/dist');
    const main = candidate ? path.resolve(hub, '../packages/workforce-client/dist') : installed;
    const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
    expect(sha(path.join(main, 'client.js'))).toBe(
      candidate
        ? 'bed79c0069e5840c5646996eadd08f32990010001e3487cd9dfd0c76cf6ee267'
        : '3afcd220bf828040e8ea366178a3d54b80c14a16c59ae8e87782804f3cae3d38',
    );
    const selected = await import(path.join(main, 'index.js'));
    expect(transport.createWorkforceClient).toBe(selected.createWorkforceClient);
    const installedIdentity = await import(path.join(installed, 'identity-jwt.js'));
    expect(identity.mintIdentity).toBe(installedIdentity.mintIdentity);
    expect(sha(path.join(installed, 'identity-jwt.js'))).toBe(
      'db706a1be4f86f5da9bbf88d1911c434086d72af00906d80112fdd4bb623606f',
    );
  });

  it.each(['html', 'json', 'native'])(
    'actual intake GET and POST never log or return upstream %s canaries',
    async (kind) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const fetch = vi.fn<typeof globalThis.fetch>(async () => {
        if (kind === 'native')
          throw new Error('NATIVE-CANARY', { cause: { token: 'CAUSE-CANARY' } });
        return new Response(
          kind === 'html' ? '<html>BODY-CANARY</html>' : '{"secret":"BODY-CANARY"}',
          {
            status: 502,
            headers: { 'x-private': 'HEADER-CANARY' },
          },
        );
      });
      vi.stubGlobal('fetch', fetch);
      const result = await intakeStatus(event() as unknown as Parameters<typeof intakeStatus>[0]);
      const created = await intakeCreate(
        event('/api/workforce/factory-intake', 'POST') as unknown as Parameters<
          typeof intakeCreate
        >[0],
      );
      expect(result.status).toBe(502);
      expect(created.status).toBe(502);
      const visible =
        (await result.text()) + (await created.text()) + inspect(warn.mock.calls, { depth: 10 });
      expect(visible).not.toContain('CANARY');
      expect(warn).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({
        routingTarget: { type: 'user' },
      });
      expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('origin')).toBe(
        'https://hub.example.test',
      );
    },
  );

  it('actual activity loader projects malformed200 to502 and preserves genuine404', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('<html>BODY-CANARY</html>'))
      .mockResolvedValueOnce(new Response('{"secret":"BODY-CANARY"}', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      activityLoad(event() as unknown as Parameters<typeof activityLoad>[0]),
    ).rejects.toMatchObject({ status: 502, body: { message: 'paperclip unavailable' } });
    await expect(
      activityLoad(event() as unknown as Parameters<typeof activityLoad>[0]),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('actual inbox and layout logs receive only projected transport failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('NATIVE-CANARY', { cause: 'CAUSE-CANARY' });
      }),
    );
    await expect(
      inboxLoad(event('/workforce/inbox') as unknown as Parameters<typeof inboxLoad>[0]),
    ).resolves.toMatchObject({ items: [], liveInboxAvailable: false });
    await expect(
      layoutLoad(event('/workforce/activity') as unknown as Parameters<typeof layoutLoad>[0]),
    ).rejects.toMatchObject({ status: 502 });
    expect(warn).toHaveBeenCalledTimes(3);
    expect(inspect(warn.mock.calls, { depth: 10 })).not.toContain('CANARY');
    expect(fixtures.organization).not.toHaveBeenCalled();
  });

  it('actual company recovery preserves404 admission, requested identity and successful creation', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{"id":"org-qc"}'));
    vi.stubGlobal('fetch', fetch);
    await expect(
      ensureWorkforceCompany(
        event() as unknown as Parameters<typeof ensureWorkforceCompany>[0],
        'org-qc',
      ),
    ).resolves.toBe('org-qc');
    expect(fixtures.organization).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1]?.method).toBe('POST');
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toEqual({
      id: 'org-qc',
      name: 'Test org',
    });
  });

  it('actual company ID mismatch cleans up the synthetic orphan once and fails409', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{"id":"wrong-id"}'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      ensureWorkforceCompany(
        event() as unknown as Parameters<typeof ensureWorkforceCompany>[0],
        'org-qc',
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(fetch.mock.calls[2]?.[0])).toBe('http://workforce.test/api/companies/wrong-id');
    expect(fetch.mock.calls[2]?.[1]?.method).toBe('DELETE');
  });

  it('actual company recovery does not provision on non404 failure', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      ensureWorkforceCompany(
        event() as unknown as Parameters<typeof ensureWorkforceCompany>[0],
        'org-qc',
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fixtures.organization).not.toHaveBeenCalled();
  });

  if (candidate) {
    it('records the existing inbox cancellation-swallowing limitation without dispatch', async () => {
      const owner = new AbortController();
      owner.abort('ABORT-CANARY');
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // TODO(handoff): The helper rejects cancellation, but this real loader intentionally
      // degrades all rejected work. Route-owned cancellation changes remain outside14-05.
      // See proposals/2026-09-08-platform-qc-remediation.md, Workforce candidate JSON transport.
      await expect(
        inboxLoad(
          event('/workforce/inbox', 'GET', owner.signal) as unknown as Parameters<
            typeof inboxLoad
          >[0],
        ),
      ).resolves.toMatchObject({ items: [], liveInboxAvailable: false });
      expect(fetch).not.toHaveBeenCalled();
      expect(inspect(warn.mock.calls, { depth: 10 })).not.toContain('CANARY');
    });
  } else {
    it('installed direct-package negative control retains native SyntaxError on upstream HTML', async () => {
      const client = transport.createWorkforceClient({
        baseUrl: 'http://workforce.test',
        fetch: vi.fn(async () => new Response('<html>baseline</html>')),
      });
      await expect(client.health.get()).rejects.toBeInstanceOf(SyntaxError);
    });
  }
});
