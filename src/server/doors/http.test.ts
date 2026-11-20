import { describe, expect, it } from 'vitest';
import { DoorError } from '$server/services/doors.service';
import { doorErrorResponse } from './http';

describe('doorErrorResponse', () => {
  it('keeps error equal to the code and adds message and code', async () => {
    const res = doorErrorResponse(new DoorError('slug_taken', 409));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      message: 'slug_taken',
      error: 'slug_taken',
      code: 'slug_taken',
    });
  });

  it('preserves issues', async () => {
    const issues = [{ path: ['a'], message: 'bad' }];
    const body = await doorErrorResponse(new DoorError('invalid_config', 400, issues)).json();
    expect(body).toMatchObject({ error: 'invalid_config', code: 'invalid_config', issues });
  });

  it('re-throws anything else', () => {
    const boom = new Error('boom');
    expect(() => doorErrorResponse(boom)).toThrow(boom);
  });
});
