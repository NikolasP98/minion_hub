import { describe, expect, it } from 'vitest';
import { NotificationProjectionUnavailable } from './contracts';

describe('NotificationProjectionUnavailable', () => {
  it('keeps the public reason and carries the driver error as cause with its code', () => {
    const cause = Object.assign(new Error('canceling statement due to statement timeout'), {
      name: 'PostgresError',
      code: '57014',
    });
    const error = new NotificationProjectionUnavailable('revalidation_unavailable', { cause });
    expect(error).toMatchObject({
      name: 'NotificationProjectionUnavailable',
      code: 'notification_projection_unavailable',
      reason: 'revalidation_unavailable',
      message: 'Notification audience projection is unavailable',
      causeCode: '57014',
    });
    expect(error.cause).toBe(cause);
  });

  it('reports no cause code without a driver error', () => {
    const error = new NotificationProjectionUnavailable('deadline');
    expect(error).toMatchObject({ reason: 'deadline', causeCode: null });
    expect(error.cause).toBeUndefined();
    expect(
      new NotificationProjectionUnavailable('revalidation_unavailable', { cause: new Error('x') })
        .causeCode,
    ).toBeNull();
  });
});
