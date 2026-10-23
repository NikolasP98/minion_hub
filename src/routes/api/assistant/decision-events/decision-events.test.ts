import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
const sink = vi.hoisted(() => ({ capture: vi.fn(), enabled: true }));
vi.mock('$env/dynamic/public', () => ({
  env: {
    get PUBLIC_POSTHOG_KEY() {
      return sink.enabled ? 'fixture-key' : undefined;
    },
  },
}));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({}) }));
vi.mock('$server/ai-usage', () => ({ setAiUsageOrg: vi.fn() }));
vi.mock('posthog-node', () => ({
  PostHog: class {
    capture = sink.capture;
    on() {}
    flush = async () => {};
  },
}));
import { POST } from './+server';
import { isSelfOnlyObservation, apiWriteCapability } from '$server/services/rbac.service';
const observation = () => ({
  kind: 'decision_applied',
  eventId: crypto.randomUUID(),
  submissionId: crypto.randomUUID(),
  actorId: 'forged-actor',
  orgId: 'forged-org',
  origin: 'user',
  loaded_sandbox: true,
});
function event(
  body: unknown,
  options: { user?: boolean; org?: boolean; headers?: Record<string, string>; raw?: string } = {},
) {
  const actor = 'fixture-actor-' + crypto.randomUUID();
  return {
    url: new URL('http://localhost/api/assistant/decision-events'),
    route: { id: '/api/assistant/decision-events' },
    locals: {
      user: options.user === false ? undefined : { id: actor, role: 'user' },
      tenantCtx: options.org === false ? undefined : { tenantId: 'fixture-org' },
    },
    request: new Request('http://localhost/api/assistant/decision-events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
        ...options.headers,
      },
      body: options.raw ?? JSON.stringify(body),
    }),
  } as unknown as RequestEvent;
}
const settle = async () => {
  await vi.dynamicImportSettled();
  await new Promise<void>((resolve) => setImmediate(resolve));
};
beforeEach(() => sink.capture.mockClear());
describe('actual authenticated self-only observation endpoint', () => {
  it('retains exact self-only classification and no business mutation grant', () => {
    expect(isSelfOnlyObservation('/api/assistant/decision-events', 'POST')).toBe(true);
    expect(isSelfOnlyObservation('/api/assistant/decision-events/other', 'POST')).toBe(false);
    expect(isSelfOnlyObservation('/api/assistant/decision-events', 'GET')).toBe(false);
    expect(apiWriteCapability('/api/assistant/decision-events', 'POST')).toBeNull();
  });
  it('requires actual current authenticated user and tenant', async () => {
    for (const options of [{ user: false }, { org: false }])
      await expect(
        POST(event({ version: 1, events: [observation()] }, options)),
      ).rejects.toMatchObject({ status: 401 });
    expect(sink.capture).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([
    { origin: 'https://external.invalid' },
    { 'sec-fetch-site': 'cross-site' },
    { 'content-type': 'text/plain' },
  ])('rejects origin/type failure before capture %j', async (headers) => {
    await expect(
      POST(event({ version: 1, events: [observation()] }, { headers })),
    ).rejects.toMatchObject({ status: headers['content-type'] ? 415 : 403 });
    expect(sink.capture).not.toHaveBeenCalled();
  });
  it('overwrites forged identity with server actor/org through the final SDK sanitizer', async () => {
    const request = event({ version: 1, events: [observation()] });
    const response = await POST(request);
    await settle();
    expect(await response.json()).toEqual({ accepted: 1 });
    expect(sink.capture).toHaveBeenCalledTimes(1);
    const captured = sink.capture.mock.calls[0][0];
    expect(captured).toMatchObject({
      event: 'assistant_decision_applied',
      distinctId: 'org:fixture-org',
      properties: {
        actor_id: request.locals.user?.id,
        org_id: 'fixture-org',
        loaded_sandbox: true,
      },
    });
    expect(JSON.stringify(captured)).not.toContain('forged');
  });
  it('rejects unknown kind/property, nested data, malformed UUID, batch overflow and streamed bytes', async () => {
    for (const extra of [
      { kind: 'arbitrary' },
      { prompt: 'private' },
      { loaded_sandbox: {} },
      { eventId: 'bad' },
    ])
      await expect(
        POST(event({ version: 1, events: [{ ...observation(), ...extra }] })),
      ).rejects.toMatchObject({ status: 400 });
    await expect(
      POST(event({ version: 1, events: Array.from({ length: 21 }, observation) })),
    ).rejects.toMatchObject({ status: 400 });
    const request = event(null);
    const bytes = new TextEncoder().encode('x'.repeat(16385));
    request.request = new Request(request.url, {
      method: 'POST',
      headers: request.request.headers,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.subarray(0, 8000));
          controller.enqueue(bytes.subarray(8000));
          controller.close();
        },
      }),
      duplex: 'half',
    } as RequestInit);
    await expect(POST(request)).rejects.toMatchObject({ status: 413 });
    expect(sink.capture).not.toHaveBeenCalled();
  });
  it('charges whole validated batches by events; rejected 20-event batch captures nothing', async () => {
    const first = event({ version: 1, events: Array.from({ length: 20 }, observation) });
    for (let i = 0; i < 6; i++) {
      const request = event({ version: 1, events: Array.from({ length: 20 }, observation) });
      request.locals = first.locals;
      await POST(request);
    }
    await settle();
    expect(sink.capture).toHaveBeenCalledTimes(120);
    const denied = event({ version: 1, events: Array.from({ length: 20 }, observation) });
    denied.locals = first.locals;
    await expect(POST(denied)).rejects.toMatchObject({ status: 429 });
    await settle();
    expect(sink.capture).toHaveBeenCalledTimes(120);
  });
});

it('accepts validated observations when capture is disabled without calling the SDK', async () => {
  sink.enabled = false;
  vi.resetModules();
  try {
    const { POST: disabledPost } = await import('./+server');
    const response = await disabledPost(event({ version: 1, events: [observation()] }));
    expect(await response.json()).toEqual({ accepted: 1 });
    await settle();
    expect(sink.capture).not.toHaveBeenCalled();
  } finally {
    sink.enabled = true;
    vi.resetModules();
  }
});
