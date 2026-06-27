import { describe, it, expect } from 'vitest';
import { channelKey, projectChannelRow, toResolvedChannels } from './channel-publish.service';

describe('channelKey', () => {
  it('is the agreed type:accountId form (no gatewayId — single-gateway tracer)', () => {
    expect(channelKey('whatsapp', '+51906090526')).toBe('channel:whatsapp:+51906090526');
  });
});

describe('projectChannelRow (strict allowlist — no secret leak, consensus M2)', () => {
  it('emits exactly the 5 projection fields', () => {
    const p = projectChannelRow({
      enabled: true,
      allowFrom: ['*'],
      groupAllowFrom: [],
      requireMention: true,
      replies: 'bound',
    });
    expect(Object.keys(p).sort()).toEqual([
      'allowFrom',
      'enabled',
      'groupAllowFrom',
      'replies',
      'requireMention',
    ]);
  });

  it('NEVER carries a credential even if the row object smuggles one in', () => {
    // Simulate an over-broad row (e.g. a future spread bug): extra secret-shaped keys.
    const dirty = {
      enabled: true,
      allowFrom: [],
      groupAllowFrom: [],
      requireMention: true,
      replies: 'none',
      botToken: 'SECRET-123',
      token: 'SECRET-456',
      accessToken: 'SECRET-789',
    } as unknown as Parameters<typeof projectChannelRow>[0];
    const serialized = JSON.stringify(projectChannelRow(dirty));
    expect(serialized).not.toMatch(/SECRET|botToken|accessToken/);
    expect(serialized).not.toMatch(/"token"/);
  });

  it('null array columns coerce to [] (DB nullable → safe default)', () => {
    const p = projectChannelRow({
      enabled: false,
      allowFrom: null,
      groupAllowFrom: null,
      requireMention: false,
      replies: 'none',
    });
    expect(p.allowFrom).toEqual([]);
    expect(p.groupAllowFrom).toEqual([]);
  });

  it('coerces an unknown replies value to none (closed default)', () => {
    const p = projectChannelRow({
      enabled: true,
      allowFrom: [],
      groupAllowFrom: [],
      requireMention: true,
      replies: 'garbage',
    });
    expect(p.replies).toBe('none');
  });
});

describe('toResolvedChannels (hub hydration mapper)', () => {
  const waRow = {
    type: 'whatsapp',
    accountId: '+51906090526',
    enabled: true,
    allowFrom: [] as string[],
    groupAllowFrom: [] as string[],
    requireMention: true,
    replies: 'none',
  };

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
