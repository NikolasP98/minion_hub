import { describe, it, expect } from 'vitest';
import { channelKey, projectChannelRow, toResolvedChannels } from './channel-publish.service';

describe('channelKey', () => {
  it('is the agreed type:accountId form (no gatewayId — single-gateway tracer)', () => {
    expect(channelKey('whatsapp', '+51906090526')).toBe('channel:whatsapp:+51906090526');
  });
});

describe('projectChannelRow (strict allowlist — no secret leak, consensus M2)', () => {
  it('emits exactly the projection fields (incl. P3-T1 settings + authRef)', () => {
    const p = projectChannelRow({
      enabled: true,
      allowFrom: ['*'],
      groupAllowFrom: [],
      requireMention: true,
      replies: 'bound',
      settings: { debounceMs: 500 },
      authRef: 'whatsapp/+51906090526',
    });
    expect(Object.keys(p).sort()).toEqual([
      'allowFrom',
      'authRef',
      'enabled',
      'groupAllowFrom',
      'replies',
      'requireMention',
      'settings',
    ]);
    expect(p.settings).toEqual({ debounceMs: 500 });
    expect(p.authRef).toBe('whatsapp/+51906090526');
  });

  it('defaults settings to {} and authRef to null when absent', () => {
    const p = projectChannelRow({
      enabled: true,
      allowFrom: [],
      groupAllowFrom: [],
      requireMention: true,
      replies: 'none',
    });
    expect(p.settings).toEqual({});
    expect(p.authRef).toBeNull();
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

  it('keeps account-keyed rows and projects the allowlisted set (incl. settings/authRef/orgId)', () => {
    expect(
      toResolvedChannels([
        {
          ...waRow,
          tenantId: 'org-1',
          settings: { debounceMs: 500 },
          authRef: 'whatsapp/+51906090526',
        },
      ]),
    ).toEqual([
      {
        accountId: '+51906090526',
        type: 'whatsapp',
        orgId: 'org-1',
        ownerProfileId: null,
        projection: {
          enabled: true,
          allowFrom: [],
          groupAllowFrom: [],
          requireMention: true,
          replies: 'none',
          settings: { debounceMs: 500 },
          authRef: 'whatsapp/+51906090526',
        },
      },
    ]);
  });

  it('carries ownerProfileId (P0 user-scoped classification primitive) through untouched', () => {
    const out = toResolvedChannels([
      { ...waRow, tenantId: 'org-1', ownerProfileId: 'profile-1' },
    ]);
    expect(out[0].ownerProfileId).toBe('profile-1');
    // org-scoped row (no owner) — orgId still present, ownerProfileId null.
    expect(toResolvedChannels([{ ...waRow, tenantId: 'org-1' }])[0].ownerProfileId).toBeNull();
  });

  it('keeps all migrated types (whatsapp/telegram/discord), drops unknown types + null/empty accountId', () => {
    const out = toResolvedChannels([
      { ...waRow, type: 'telegram', accountId: 'bot123' },
      { ...waRow, type: 'discord', accountId: 'guild1' },
      { ...waRow, type: 'slack', accountId: 'team1' }, // not migrated → dropped
      { ...waRow, accountId: null },
      { ...waRow, accountId: '' },
    ]);
    expect(out.map((c) => `${c.type}:${c.accountId}`)).toEqual(['telegram:bot123', 'discord:guild1']);
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
