import { describe, expect, it } from 'vitest';
import { gatewayConfigToChannelRows } from './channel-sync.service';

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

    // whatsapp gets an explicit creds pointer (never the creds).
    expect(faces.channel.authRef).toBe('whatsapp/+51992376833');
  });

  // ★ Resolve, don't read raw (consensus C1): root-level defaults must fall through.
  it('resolves root-level channel defaults onto accounts that omit them', () => {
    const cfg = {
      channels: {
        whatsapp: {
          dmPolicy: 'open', // root default → account inherits → allowFrom ['*']
          allowFrom: ['+51999'], // overridden by open derivation
          accounts: {
            '+51111': { name: 'Inherits Open' }, // no per-acct dmPolicy/allowFrom
            '+51222': { dmPolicy: 'allowlist', allowFrom: ['+51888'] }, // explicit
          },
        },
        accountOrgs: { whatsapp: { '+51111': [ORG], '+51222': [ORG] } },
      },
      bindings: [],
    };
    const byId = Object.fromEntries(
      gatewayConfigToChannelRows(cfg, ORG).map((r) => [r.channel.accountId, r]),
    );
    // Inherits root dmPolicy:open → ['*'], not [] (would silently block DMs).
    expect(byId['+51111'].channel.allowFrom).toEqual(['*']);
    // Explicit allowlist account keeps its own list.
    expect(byId['+51222'].channel.allowFrom).toEqual(['+51888']);
  });

  // ★ settings = strict allowlist, never a spread (consensus M2 / security).
  it('extracts only allowlisted transport knobs and never secrets', () => {
    const cfg = {
      channels: {
        whatsapp: {
          accounts: {
            '+51333': {
              name: 'Knobs',
              dmPolicy: 'allowlist',
              allowFrom: ['+51777'],
              debounceMs: 500,
              sendReadReceipts: false,
              authDir: '/secret/creds/path', // secret — must NOT appear
            },
          },
        },
        accountOrgs: { whatsapp: { '+51333': [ORG] } },
      },
      bindings: [],
    };
    // a telegram account with an inline bot token must not leak it.
    const tg = {
      channels: {
        telegram: {
          accounts: { bot1: { name: 'TG', botToken: '123:SECRET', block: true } },
        },
        accountOrgs: { telegram: { bot1: [ORG] } },
      },
      bindings: [],
    };
    const wa = gatewayConfigToChannelRows(cfg, ORG)[0].channel;
    expect(wa.settings).toEqual({ debounceMs: 500, sendReadReceipts: false });
    expect(JSON.stringify(wa.settings)).not.toContain('/secret/creds/path');

    const tgRow = gatewayConfigToChannelRows(tg, ORG)[0].channel;
    expect(tgRow.settings).toEqual({ block: true });
    expect(JSON.stringify(tgRow.settings)).not.toContain('SECRET');
    expect(tgRow.authRef).toBeNull(); // telegram token is inline → no disk pointer
  });
});
