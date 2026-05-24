import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import {
  listIdentities,
  attachIdentity,
  findByChannelKey,
  getGoogleCredential,
} from './identity.service';
import { encryptAdc } from './identity-secrets';

vi.mock('$server/db/utils', () => ({
  newId: () => 'mock-id-00000001',
  nowMs: () => 1_700_000_000_000,
}));

beforeEach(() => vi.clearAllMocks());

describe('identity.service', () => {
  it('listIdentities reads rows for the user', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'i1', userId: 'u1', provider: 'whatsapp', kind: 'channel', externalId: '+51999' }],
    ]);
    const rows = await listIdentities({ db, tenantId: 't1' } as never, 'u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].provider).toBe('whatsapp');
  });

  it('attachIdentity inserts and returns a string id', async () => {
    const { db } = createMockDb();
    const id = await attachIdentity({ db, tenantId: 't1' } as never, 'u1', {
      channel: 'whatsapp',
      channelUserId: '+51999',
      displayName: 'Nik',
      verified: true,
    });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('findByChannelKey maps channel+id onto provider+externalId lookup', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'i1', userId: 'u1', provider: 'telegram', kind: 'channel', externalId: '123' }],
    ]);
    const row = await findByChannelKey({ db, tenantId: 't1' } as never, 'telegram', '123');
    expect(row?.userId).toBe('u1');
  });

  it('getGoogleCredential decrypts the stored ADC for a user', async () => {
    const enc = encryptAdc({
      client_id: 'cid',
      client_secret: 'sec',
      refresh_token: 'rt',
      type: 'authorized_user',
    });
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [
        {
          id: 'g1',
          userId: 'u1',
          provider: 'google',
          kind: 'oauth',
          externalId: 'nik@example.com',
          secretCiphertext: enc.ciphertext,
          secretIv: enc.iv,
        },
      ],
    ]);
    const cred = await getGoogleCredential({ db, tenantId: 't1' } as never, 'u1');
    expect(cred).toEqual({
      email: 'nik@example.com',
      adc: { client_id: 'cid', client_secret: 'sec', refresh_token: 'rt', type: 'authorized_user' },
    });
  });

  it('getGoogleCredential returns null when no google identity exists', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[]]);
    const cred = await getGoogleCredential({ db, tenantId: 't1' } as never, 'u1');
    expect(cred).toBeNull();
  });
});
