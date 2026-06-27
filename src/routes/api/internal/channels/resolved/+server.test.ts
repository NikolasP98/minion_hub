import { describe, it, expect } from 'vitest';
import { toResolvedChannels } from './+server';

const waRow = {
  type: 'whatsapp',
  accountId: '+51906090526',
  enabled: true,
  allowFrom: [] as string[],
  groupAllowFrom: [] as string[],
  requireMention: true,
  replies: 'none',
};

describe('toResolvedChannels (hub hydration mapper)', () => {
  it('keeps whatsapp phone-keyed rows and projects the allowlisted set', () => {
    expect(toResolvedChannels([waRow])).toEqual([
      {
        accountId: '+51906090526',
        type: 'whatsapp',
        projection: {
          enabled: true,
          allowFrom: [],
          groupAllowFrom: [],
          requireMention: true,
          replies: 'none',
        },
      },
    ]);
  });

  it('drops non-whatsapp and null/empty accountId rows', () => {
    expect(
      toResolvedChannels([
        { ...waRow, type: 'telegram', accountId: 'bot123' },
        { ...waRow, accountId: null },
        { ...waRow, accountId: '' },
      ]),
    ).toEqual([]);
  });

  it('never leaks a credential-shaped field even if a row smuggles one in', () => {
    const dirty = { ...waRow, accountId: '+1', botToken: 'SECRET', token: 'SECRET2' } as unknown as Parameters<
      typeof toResolvedChannels
    >[0][number];
    const serialized = JSON.stringify(toResolvedChannels([dirty]));
    expect(serialized).not.toMatch(/SECRET|botToken/);
    expect(serialized).not.toMatch(/"token"/);
  });
});
