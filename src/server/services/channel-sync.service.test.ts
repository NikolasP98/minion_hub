import { describe, expect, it } from 'vitest';
import {
  buildGatewayChannelPatch,
  gatewayConfigToChannelRows,
  type ChannelRow,
} from './channel-sync.service';

const ORG = '21e0601b-f632-43fd-8414-d644af4271f4';

// Shape mirrors the live gateway.json (Faces Sculptors + a noAgent account).
const config = {
  channels: {
    whatsapp: {
      accounts: {
        '+51992376833': {
          name: 'Faces Sculptors',
          enabled: true,
          dmPolicy: 'open',
          allowFrom: ['*'],
          groupPolicy: 'allowlist',
        },
        '+51906090526': {
          name: 'FACES OFICIAL',
          enabled: true,
          dmPolicy: 'open',
          allowFrom: ['*'],
        },
        '+51000000000': { name: 'OtherOrg', enabled: true }, // different org → skipped
      },
    },
    accountOrgs: {
      whatsapp: {
        '+51992376833': [ORG],
        '+51906090526': [ORG],
        '+51000000000': ['some-other-org'],
      },
    },
  },
  bindings: [
    { agentId: 'faces_public', match: { channel: 'whatsapp', accountId: '+51992376833' } },
    {
      agentId: 'clinic',
      match: { channel: 'whatsapp', accountId: '+51992376833', peer: { kind: 'direct', id: '+51923313093' } },
    },
    { agentId: null, match: { channel: 'whatsapp', accountId: '+51906090526' } },
  ],
};

describe('gatewayConfigToChannelRows', () => {
  it('maps only this org accounts, deriving replies + bindings', () => {
    const rows = gatewayConfigToChannelRows(config, ORG);
    const byId = Object.fromEntries(rows.map((r) => [r.channel.accountId, r]));

    // Other org account excluded.
    expect(rows).toHaveLength(2);
    expect(byId['+51000000000']).toBeUndefined();

    // Faces Sculptors: has a real agent binding → replies 'bound'.
    const faces = byId['+51992376833'];
    expect(faces.channel).toMatchObject({
      type: 'whatsapp',
      label: 'Faces Sculptors',
      enabled: true,
      replies: 'bound',
      allowFrom: ['*'],
      requireMention: true,
    });
    expect(faces.bindings).toEqual([
      { matchKind: 'catchall', matchPeer: null, agentId: 'faces_public' },
      { matchKind: 'dm_peer', matchPeer: '+51923313093', agentId: 'clinic' },
    ]);

    // FACES OFICIAL: only a null binding → replies 'none' (receive-only).
    const oficial = byId['+51906090526'];
    expect(oficial.channel.replies).toBe('none');
    expect(oficial.bindings).toEqual([{ matchKind: 'catchall', matchPeer: null, agentId: null }]);
  });
});

describe('buildGatewayChannelPatch', () => {
  const base: ChannelRow = {
    type: 'whatsapp',
    accountId: '+51906090526',
    label: 'FACES OFICIAL',
    enabled: true,
    replies: 'none',
    allowFrom: ['*'],
    groupAllowFrom: [],
    requireMention: true,
    status: 'active',
  };
  // Another account's binding must survive the read-modify-write.
  const otherBinding = {
    agentId: 'faces_public',
    match: { channel: 'whatsapp', accountId: '+51992376833' },
  };

  it('replies=none → open dmPolicy + a single noAgent catchall, preserving others', () => {
    const patch = buildGatewayChannelPatch(base, [], [otherBinding]);
    expect(patch.channels.whatsapp.accounts['+51906090526']).toMatchObject({
      enabled: true,
      dmPolicy: 'open',
      allowFrom: ['*'],
      groups: { '*': { requireMention: true } },
    });
    expect(patch.bindings).toEqual([
      otherBinding,
      { agentId: null, match: { channel: 'whatsapp', accountId: '+51906090526' } },
    ]);
  });

  it('replies=bound → projects DB bindings (peer + catchall), allowlist when no *', () => {
    const patch = buildGatewayChannelPatch(
      { ...base, replies: 'bound', allowFrom: [] },
      [
        { matchKind: 'catchall', matchPeer: null, agentId: 'clinic' },
        { matchKind: 'dm_peer', matchPeer: '+51923313093', agentId: 'leiva' },
      ],
      [otherBinding],
    );
    expect(patch.channels.whatsapp.accounts['+51906090526']).toMatchObject({ dmPolicy: 'allowlist' });
    expect(patch.bindings).toEqual([
      otherBinding,
      { agentId: 'clinic', match: { channel: 'whatsapp', accountId: '+51906090526' } },
      {
        agentId: 'leiva',
        match: {
          channel: 'whatsapp',
          accountId: '+51906090526',
          peer: { kind: 'direct', id: '+51923313093' },
        },
      },
    ]);
  });
});
