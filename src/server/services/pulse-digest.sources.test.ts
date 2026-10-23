import { describe, it, expect, vi } from 'vitest';
import { digestFixturePolicy, digestFixtureSnapshot } from '../test-utils/pulse-digest-fixtures';
import {
  parseDigestPolicy,
  verifyDigestDependencies,
  DIGEST_OFFICIAL_SOURCES,
} from './pulse-digest.policy';
import { collectDigestSources, boundDigestEvidence } from './pulse-digest.sources';
import { isDigestPublicAddress, type DigestTransport } from './pulse-digest.fetch';
describe('bounded actual digest source collection', () => {
  it('denies disabled policies and arbitrary source/dependency expansion before transport', async () => {
    const p = digestFixturePolicy();
    const transport = vi.fn();
    await expect(
      collectDigestSources(
        { ...p, enabled: false },
        [],
        { signal: AbortSignal.timeout(100), deadline: performance.now() + 100 },
        transport,
      ),
    ).rejects.toThrow('digest_disabled');
    expect(transport).not.toHaveBeenCalled();
    for (const mutation of [
      { sources: [{ ...p.sources[0], url: 'https://attacker.invalid' }] },
      {
        sources: [
          { ...p.sources[0], dependency: { ...p.sources[0].dependency, package: 'unknown' } },
        ],
      },
      { sources: Array(6).fill(p.sources[0]) },
      { approval: { ...p.approval, upperMicroUsd: Number.MAX_SAFE_INTEGER + 1 } },
    ])
      expect(() => parseDigestPolicy({ ...p, ...mutation })).toThrow();
    expect(Object.keys(DIGEST_OFFICIAL_SOURCES)).toHaveLength(5);
  });
  it('verifies frozen installed dependency/file/lock anchors and rejects drift', async () => {
    const p = digestFixturePolicy();
    await verifyDigestDependencies(p);
    await expect(
      verifyDigestDependencies({
        ...p,
        sources: [
          { ...p.sources[0], dependency: { ...p.sources[0].dependency, fileHash: '0'.repeat(64) } },
        ],
      }),
    ).rejects.toThrow('digest_dependency_drift');
  });
  it('rejects private reserved mapped and mixed DNS answer members conservatively', () => {
    for (const address of [
      '0.0.0.0',
      '10.0.0.1',
      '127.0.0.1',
      '100.64.0.1',
      '169.254.1.1',
      '172.16.0.1',
      '192.168.1.1',
      '192.0.2.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '240.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      'fc00::1',
      'fe80::1',
      'ff00::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:8.8.8.8',
      '2001:db8::1',
      '2001::1',
      '3fff::1',
    ])
      expect(isDigestPublicAddress(address), address).toBe(false);
    for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
      expect(isDigestPublicAddress(address), address).toBe(true);
  });
  it('uses deterministic timestamp and ETag independent identity and retained 304 evidence', async () => {
    const p = digestFixturePolicy();
    const first = await digestFixtureSnapshot(p);
    const checkpoint = first.sources.map((s) => ({ ...s, revision: 1 }));
    const spy = vi.fn<DigestTransport>(async () => ({
      status: 304 as const,
      body: '',
      etag: 'new transport etag',
      lastModified: 'later',
    }));
    const second = await collectDigestSources(
      p,
      checkpoint,
      { signal: AbortSignal.timeout(1000), deadline: performance.now() + 1000 },
      spy,
    );
    expect(second.hash).toBe(first.hash);
    expect(second.unchanged).toBe(true);
    expect(spy.mock.calls[0][1]).toMatchObject({ etag: 'fixture' });
    await expect(
      collectDigestSources(
        p,
        [{ ...checkpoint[0], evidence: null }],
        { signal: AbortSignal.timeout(1000), deadline: performance.now() + 1000 },
        spy,
      ),
    ).rejects.toThrow('digest_304_without_evidence');
    expect(checkpoint[0].revision).toBe(1);
  });
  it('rejects 21 items and 49153 bytes without truncation', async () => {
    const p = digestFixturePolicy(),
      snapshot = await digestFixtureSnapshot(p),
      item = snapshot.evidence[0];
    expect(() => boundDigestEvidence(Array(20).fill(item))).not.toThrow();
    expect(() => boundDigestEvidence(Array(21).fill(item))).toThrow('digest_normalized_limit');
    const base = { ...item, content: '' };
    const overhead = Buffer.byteLength(boundDigestEvidence([base]));
    expect(
      Buffer.byteLength(boundDigestEvidence([{ ...base, content: 'x'.repeat(49152 - overhead) }])),
    ).toBe(49152);
    expect(() => boundDigestEvidence([{ ...base, content: 'x'.repeat(49153 - overhead) }])).toThrow(
      'digest_normalized_limit',
    );
  });
  it('fails a whole partial collection and never modifies accepted checkpoints', async () => {
    const p = digestFixturePolicy();
    const expanded = {
      ...p,
      sources: [
        p.sources[0],
        {
          ...p.sources[0],
          id: 'openai' as const,
          dependency: { ...p.sources[0].dependency, package: '@ai-sdk/openai' },
        },
      ],
    };
    let active = 0,
      max = 0,
      count = 0;
    await expect(
      collectDigestSources(
        expanded,
        [],
        { signal: AbortSignal.timeout(1000), deadline: performance.now() + 1000 },
        async () => {
          active++;
          max = Math.max(max, active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
          if (++count === 2) throw new Error('fixture_failure');
          return { status: 200, body: '[]', etag: null, lastModified: null };
        },
      ),
    ).rejects.toThrow('fixture_failure');
    expect(max).toBe(2);
    expect(count).toBe(2);
  });
  it('denies upstream evidence URLs outside the exact official repository', async () => {
    const p = digestFixturePolicy();
    await expect(
      collectDigestSources(
        p,
        [],
        { signal: AbortSignal.timeout(1000), deadline: performance.now() + 1000 },
        async () => ({
          status: 200,
          etag: null,
          lastModified: null,
          body: JSON.stringify([
            { html_url: 'https://github.com/attacker/repo/releases/v1', tag_name: 'ai@v1' },
          ]),
        }),
      ),
    ).rejects.toThrow('digest_evidence_url');
  });
});
