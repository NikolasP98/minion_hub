import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const listEnabledSources = vi.fn();
const enqueueJob = vi.fn();
const getJobById = vi.fn();
const advanceJob = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
const reconcileParties = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
const gatewayCall = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({}));

const testEnv = vi.hoisted(() => ({ CRON_SECRET: 'sekret' }) as Record<string, string | undefined>);

vi.mock('$server/services/finance-sync-jobs.service', () => ({
  listEnabledSources: (...a: unknown[]) => listEnabledSources(...a),
  enqueueJob: (...a: unknown[]) => enqueueJob(...a),
  getJobById: (...a: unknown[]) => getJobById(...a),
}));
vi.mock('$server/services/finance-sync.service', () => ({ advanceJob: (...a: unknown[]) => advanceJob(...a) }));
vi.mock('$server/services/party.service', () => ({ reconcileParties: (...a: unknown[]) => reconcileParties(...a) }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({}) }));
vi.mock('$lib/server/gateway-rpc', () => ({ gatewayCall: (...a: unknown[]) => gatewayCall(...a) }));
vi.mock('$env/dynamic/private', () => ({ env: testEnv }));

import { GET } from './+server';

function req() {
  return { request: new Request('http://x/api/finances/sync/daily', { headers: { authorization: 'Bearer sekret' } }) } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(testEnv)) if (k !== 'CRON_SECRET') delete testEnv[k];
  listEnabledSources.mockResolvedValue([{ orgId: 'org1', provider: 'susii' }]);
  enqueueJob.mockResolvedValue({ id: 'job1' });
  advanceJob.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('GET /api/finances/sync/daily — factory monitor webhook', () => {
  it('does not call fetch when a job fails and the webhook env is unset', async () => {
    getJobById.mockResolvedValue({ status: 'failed', error: 'susii login failed: 400' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await GET(req());
    expect(await res.json()).toEqual({ started: 0, failed: 1 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs {source,title,fingerprint,url,detail} to the configured webhook on failure', async () => {
    testEnv.FINANCE_ALERT_WEBHOOK_URL = 'https://factory.minion-ai.org/hooks/monitor';
    testEnv.FINANCE_ALERT_WEBHOOK_TOKEN = 'hook-token';
    getJobById.mockResolvedValue({ status: 'failed', error: 'susii login failed: 400' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    await GET(req());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://factory.minion-ai.org/hooks/monitor');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer hook-token');
    expect(JSON.parse(init?.body as string)).toEqual({
      source: 'finance-sync',
      title: 'Finance sync failed — org org1, provider susii',
      fingerprint: 'finance-sync:org1:susii',
      url: 'https://hub.minion-ai.org/finances/settings',
      detail: 'susii login failed: 400',
    });
  });

  it('still calls channels.send when FINANCE_ALERT_TO/CHANNEL are set, independent of the webhook', async () => {
    testEnv.FINANCE_ALERT_TO = '#finance';
    testEnv.FINANCE_ALERT_CHANNEL = 'slack';
    getJobById.mockResolvedValue({ status: 'failed', error: 'boom' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await GET(req());

    expect(gatewayCall).toHaveBeenCalledWith('channels.send', expect.objectContaining({ channel: 'slack', to: '#finance' }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not alert when the job succeeds', async () => {
    getJobById.mockResolvedValue({ status: 'succeeded' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await GET(req());
    expect(await res.json()).toEqual({ started: 1, failed: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(gatewayCall).not.toHaveBeenCalled();
  });
});
