import { describe, expect, it, vi } from 'vitest';
import { createDecisionEvents } from './decision-events';
import { validateDecisionEvent } from './decision-lineage';
const event = () => ({
  kind: 'decision_prepared' as const,
  eventId: crypto.randomUUID(),
  submissionId: crypto.randomUUID(),
});
describe('strict observations and owner-bound memory buffer', () => {
  it('rejects raw/nested/unknown fields, invalid IDs, enums and inconsistent cost', () => {
    for (const extra of [
      { prompt: 'private' },
      { tool_result: {} },
      { context: [] },
      { eventId: 'bad' },
      { origin: 'guessed' },
      { cost_status: 'known', assistant_cost_usd: null },
      { cost_status: 'unknown', assistant_cost_usd: 0 },
    ])
      expect(validateDecisionEvent({ ...event(), ...extra })).toBeNull();
    expect(
      validateDecisionEvent({ ...event(), actorId: 'forged', orgId: 'forged' }),
    ).not.toHaveProperty('actorId');
    expect(
      validateDecisionEvent({ ...event(), cost_status: 'known', assistant_cost_usd: 0 }),
    ).toMatchObject({ cost_status: 'known', assistant_cost_usd: 0 });
  });
  it('holds at most 20 queued/in-flight observations, drops overflow and never retries failure', async () => {
    let release!: (r: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => (release = resolve)));
    const buffer = createDecisionEvents(fetcher);
    buffer.setOwner({ actorId: 'a', orgId: 'o' });
    for (let i = 0; i < 21; i++) buffer.enqueue(event());
    await Promise.resolve();
    expect(buffer.counters.overflow).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    buffer.enqueue(event());
    expect(buffer.counters.overflow).toBe(2);
    release(new Response('', { status: 503 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(buffer.counters.network).toBe(20);
    expect(fetcher).toHaveBeenCalledTimes(1);
    buffer.dispose();
  });
  it('aborts old owner flush and drops its evidence on A→B→A without replay', async () => {
    let release!: (r: Response) => void;
    const fetcher = vi.fn((_url, _init) => new Promise<Response>((resolve) => (release = resolve)));
    const buffer = createDecisionEvents(fetcher);
    buffer.setOwner({ actorId: 'a', orgId: 'o' });
    buffer.enqueue(event());
    await Promise.resolve();
    const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
    buffer.setOwner({ actorId: 'b', orgId: 'o' });
    buffer.setOwner({ actorId: 'a', orgId: 'o' });
    expect(signal.aborted).toBe(true);
    expect(buffer.counters.ownerChanged).toBe(1);
    release(Response.json({ accepted: 1 }));
    await Promise.resolve();
    await Promise.resolve();
    expect(buffer.counters.sent).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(buffer.snapshot().queued).toBe(0);
    buffer.dispose();
  });
});
