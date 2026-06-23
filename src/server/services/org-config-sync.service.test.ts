import { describe, it, expect } from 'vitest';
import {
  buildAccountOrgs,
  buildPluginOrgDisabled,
  replaceFlat,
  replaceNested,
} from './org-config-sync.service';

describe('buildAccountOrgs', () => {
  it('groups orgIds per (type, accountId)', () => {
    const map = buildAccountOrgs([
      { type: 'whatsapp', accountId: '+51900000001', tenantId: 'org-a' },
      { type: 'whatsapp', accountId: '+51900000001', tenantId: 'org-b' }, // shared account
      { type: 'telegram', accountId: 'bot123', tenantId: 'org-a' },
    ]);
    expect(map).toEqual({
      whatsapp: { '+51900000001': ['org-a', 'org-b'] },
      telegram: { bot123: ['org-a'] },
    });
  });

  it('skips rows with null/empty accountId (legacy, not yet linked)', () => {
    const map = buildAccountOrgs([
      { type: 'whatsapp', accountId: null, tenantId: 'org-a' },
      { type: 'whatsapp', accountId: '', tenantId: 'org-a' },
      { type: 'discord', accountId: 'guild1', tenantId: 'org-a' },
    ]);
    expect(map).toEqual({ discord: { guild1: ['org-a'] } });
  });

  it('dedupes a repeated (type, accountId, org) and sorts orgs deterministically', () => {
    const map = buildAccountOrgs([
      { type: 'whatsapp', accountId: 'x', tenantId: 'org-b' },
      { type: 'whatsapp', accountId: 'x', tenantId: 'org-a' },
      { type: 'whatsapp', accountId: 'x', tenantId: 'org-a' }, // dup
    ]);
    expect(map).toEqual({ whatsapp: { x: ['org-a', 'org-b'] } });
  });

  it('returns {} for no rows', () => {
    expect(buildAccountOrgs([])).toEqual({});
  });
});

describe('buildPluginOrgDisabled', () => {
  it('lists only orgs with disabled=true, keyed by pluginId', () => {
    const map = buildPluginOrgDisabled([
      { pluginId: 'discord', orgId: 'org-a', disabled: true },
      { pluginId: 'discord', orgId: 'org-b', disabled: false }, // re-enabled → excluded
      { pluginId: 'slack', orgId: 'org-a', disabled: true },
    ]);
    expect(map).toEqual({ discord: ['org-a'], slack: ['org-a'] });
  });

  it('omits plugins with no disabling org (no empty arrays)', () => {
    const map = buildPluginOrgDisabled([{ pluginId: 'discord', orgId: 'org-a', disabled: false }]);
    expect(map).toEqual({});
  });

  it('sorts orgs deterministically', () => {
    const map = buildPluginOrgDisabled([
      { pluginId: 'p', orgId: 'org-z', disabled: true },
      { pluginId: 'p', orgId: 'org-a', disabled: true },
    ]);
    expect(map).toEqual({ p: ['org-a', 'org-z'] });
  });
});

describe('replaceFlat (authoritative replace under merge-patch)', () => {
  it('nulls keys present on gateway but absent in DB (the isolation-leak fix)', () => {
    // gateway still disables plugin `p` for org-a; DB no longer does → must clear.
    const patch = replaceFlat({ p: ['org-a'], q: ['org-b'] }, { q: ['org-b'] });
    expect(patch).toEqual({ q: ['org-b'], p: null });
  });

  it('keeps/overwrites DB keys and nulls nothing when gateway is empty (fresh redeploy)', () => {
    expect(replaceFlat({}, { p: ['org-a'] })).toEqual({ p: ['org-a'] });
  });

  it('empties the map: every gateway key becomes null', () => {
    expect(replaceFlat({ p: ['org-a'], q: ['org-b'] }, {})).toEqual({ p: null, q: null });
  });
});

describe('replaceNested (accountOrgs type→account→orgs)', () => {
  it('nulls a whole channel type the DB dropped', () => {
    const patch = replaceNested(
      { whatsapp: { a: ['o1'] }, telegram: { b: ['o2'] } },
      { whatsapp: { a: ['o1'] } },
    );
    expect(patch).toEqual({ whatsapp: { a: ['o1'] }, telegram: null });
  });

  it('nulls a single account removed within a kept type', () => {
    const patch = replaceNested({ whatsapp: { a: ['o1'], b: ['o2'] } }, { whatsapp: { a: ['o1'] } });
    expect(patch).toEqual({ whatsapp: { a: ['o1'], b: null } });
  });

  it('adds new types/accounts (fresh gateway)', () => {
    expect(replaceNested({}, { telegram: { x: ['o9'] } })).toEqual({ telegram: { x: ['o9'] } });
  });
});
