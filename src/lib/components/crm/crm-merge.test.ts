import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyContactMerge,
  fetchFreshMergeGroups,
  CrmMergeOutcomeUnknownError,
  CrmMergeSensitiveFieldsRestrictedError,
  isCrmMergeSensitiveFieldsRestricted,
} from './crm-merge';

const reply = (status: number, body: unknown, raw = false) =>
  vi.fn(async () => new Response(raw ? (body as string) : JSON.stringify(body), { status }));
afterEach(() => vi.unstubAllGlobals());

describe('applyContactMerge outcomes', () => {
  it('resolves on {ok:true}', async () => {
    vi.stubGlobal('fetch', reply(200, { ok: true }));
    await expect(applyContactMerge('s', ['l'], {})).resolves.toBeUndefined();
  });
  it('maps the 403 refusal to the typed error', async () => {
    vi.stubGlobal('fetch', reply(403, { message: 'sensitive_fields_restricted' }));
    const err = await applyContactMerge('s', ['l'], {}).catch((e) => e);
    expect(err).toBeInstanceOf(CrmMergeSensitiveFieldsRestrictedError);
    expect(isCrmMergeSensitiveFieldsRestricted(err)).toBe(true);
  });
  it.each([
    ['500', reply(500, { message: 'db exploded: secret' })],
    ['other 403', reply(403, { message: 'nope' })],
    ['malformed acknowledgement', reply(200, 'not json', true)],
    ['missing ok', reply(200, {})],
    ['transport loss', vi.fn(async () => Promise.reject(new TypeError('offline')))],
  ])('%s is outcome-unknown with a fixed message', async (_n, f) => {
    vi.stubGlobal('fetch', f);
    const err = await applyContactMerge('s', ['l'], {}).catch((e) => e);
    expect(err).toBeInstanceOf(CrmMergeOutcomeUnknownError);
    expect(err.message).not.toContain('secret');
  });
});

describe('fetchFreshMergeGroups', () => {
  it('returns the groups of a valid envelope and reads uncached', async () => {
    const f = reply(200, { groups: [{ key: 'a' }] });
    vi.stubGlobal('fetch', f);
    expect(await fetchFreshMergeGroups()).toEqual([{ key: 'a' }]);
    expect((f.mock.calls[0] as unknown[])[1]).toMatchObject({ cache: 'no-store' });
  });
  it.each([reply(500, {}), reply(200, { nope: 1 }), reply(200, 'x', true)])(
    'rejects %#',
    async (f) => {
      vi.stubGlobal('fetch', f);
      await expect(fetchFreshMergeGroups()).rejects.toThrow('fresh read failed');
    },
  );
});
