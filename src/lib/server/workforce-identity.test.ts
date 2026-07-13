import { describe, expect, it, vi } from 'vitest';
import { jwtVerify } from 'jose';

const secret = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=';

vi.mock('$env/dynamic/private', () => ({
  env: {
    HUB_WORKFORCE_SHARED_SECRET: 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDE=',
  },
}));

import { mintWorkforceIdentity } from './workforce-identity';

async function payload(token: string) {
  return (
    await jwtVerify(token, new Uint8Array(Buffer.from(secret, 'base64')), {
      algorithms: ['HS256'],
    })
  ).payload;
}

describe('mintWorkforceIdentity', () => {
  it('signs canonical role keys and invalidates the cache when the role set changes', async () => {
    const baseClaims = {
      userId: 'user-1',
      email: 'user@example.com',
      name: 'User',
      companyId: 'company-1',
    };
    const first = await mintWorkforceIdentity({
      ...baseClaims,
      roleKeys: [' staff ', 'manager', 'staff'],
    });
    const sameRoleSet = await mintWorkforceIdentity({
      ...baseClaims,
      roleKeys: ['manager', 'staff'],
    });
    const changedRoleSet = await mintWorkforceIdentity({
      ...baseClaims,
      roleKeys: ['staff'],
    });

    expect((await payload(first)).roleKeys).toEqual(['manager', 'staff']);
    expect(sameRoleSet).toBe(first);
    expect(changedRoleSet).not.toBe(first);
    expect((await payload(changedRoleSet)).roleKeys).toEqual(['staff']);
  });
});
