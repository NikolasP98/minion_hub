import { describe, expect, it } from 'vitest';
import { SandboxQueryError } from '$server/sandbox/query-compiler';
import { sandboxErrorResponse } from './_errors';

describe('sandboxErrorResponse', () => {
  it('adds message and code and keeps error, field and status', async () => {
    const res = sandboxErrorResponse(new SandboxQueryError('bad limit', 'limit', 403));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      message: 'bad limit',
      error: 'bad limit',
      code: 'sandbox_invalid',
      field: 'limit',
    });
  });

  it('re-throws anything else', () => {
    const boom = new Error('boom');
    expect(() => sandboxErrorResponse(boom)).toThrow(boom);
  });
});
