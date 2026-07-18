import { describe, it, expect, vi } from 'vitest';
import { POST } from './+server';

function req(body: unknown) {
  return new Request('http://x/api/gateway/pulse/proposals', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/gateway/pulse/proposals', () => {
  it('401 without server token', async () => {
    await expect(POST({ locals: {}, request: req({}) } as any)).rejects.toMatchObject({ status: 401 });
  });
  it('400 without orgId', async () => {
    await expect(POST({ locals: { serverId: 's1' }, request: req({ proposals: [] }) } as any))
      .rejects.toMatchObject({ status: 400 });
  });
});
