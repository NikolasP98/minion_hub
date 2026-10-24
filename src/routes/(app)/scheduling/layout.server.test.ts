import { describe, it, expect, vi } from 'vitest';

/** Spec 039 S3: the scheduling layout authenticates through the scheduling dataset handle. */
const datasetCtx = vi.hoisted(() => vi.fn());
vi.mock('$server/auth/dataset-ctx', () => ({ datasetCtx }));

describe('/scheduling +layout.server load', () => {
  it('asks for the scheduling handle and never throws on denial (pages render the marker)', async () => {
    datasetCtx.mockResolvedValue({ denied: 'scheduling', verb: 'view' });
    const { load } = await import('./+layout.server');
    const out = await load({ locals: {} } as unknown as Parameters<typeof load>[0]);
    expect(datasetCtx).toHaveBeenCalledWith({}, 'scheduling');
    expect(out).toEqual({});
  });
});
