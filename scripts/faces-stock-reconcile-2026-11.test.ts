import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loaderImported = vi.fn();
vi.mock('./lib/operator-service-loader', () => {
  loaderImported();
  return { createOperatorServiceLoader: vi.fn() };
});
const verify = vi.fn();
vi.mock('./lib/operator-principal', async (orig) => ({
  ...(await orig<typeof import('./lib/operator-principal')>()),
  verifyOperatorPrincipal: (...a: unknown[]) => verify(...a),
}));

import { operatorDatabaseIdentity } from './lib/operator-principal';
import {
  CliAdmissionError,
  admitOutputPath,
  checkDiagnosticAuthority,
  parseArgs,
  readPrivateJson,
  run,
  writePrivateOutput,
  type Authority,
} from './faces-stock-reconcile-2026-11';
import { decodeDiagnosticManifestV1 } from './lib/faces-stock-reconciliation';

const ORG = '11111111-1111-4111-8111-111111111111';
const ACTOR = '22222222-2222-4222-8222-222222222222';
const BOOKING = '33333333-3333-4333-8333-333333333333';
const URL_OK = 'postgres://u:p@127.0.0.1:5432/faces';
const AUTH = { authProject: 'proj', authUrl: 'https://auth.example.org' };
let dir: string;

const manifest = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  target: { databaseIdentity: operatorDatabaseIdentity(URL_OK, 'proj'), ...AUTH },
  actorProfileId: ACTOR,
  cases: [
    {
      caseKey: 'c1',
      bookingIds: [BOOKING],
      ticketIds: [],
      itemIds: [],
      identityUnresolved: false,
      searchHint: null,
      dateHints: null,
      evidenceRefs: [],
    },
  ],
  ...over,
});
const put = (name: string, value: unknown, mode = 0o600) => {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value), { mode });
  chmodSync(p, mode);
  return p;
};
const env = {
  FACES_STOCK_DATABASE_URL: URL_OK,
  FACES_OPERATOR_ACCESS_TOKEN: 't',
  FACES_OPERATOR_ANON_KEY: 'a',
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'faces-recon-'));
  chmodSync(dir, 0o700);
  loaderImported.mockClear();
  verify.mockReset();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('argument and file guards', () => {
  it('accepts only the exact flag set', () => {
    const ok = ['--org', ORG, '--case-manifest', 'a', '--output', 'b'];
    expect(parseArgs(ok)).toEqual({ org: ORG, manifestPath: 'a', outputPath: 'b' });
    for (const bad of [
      [],
      ['--org', ORG],
      [...ok, '--apply'],
      [...ok, '--org', ORG],
      ['--org', 'nope', '--case-manifest', 'a', '--output', 'b'],
      ['--org', ORG, '--case-manifest', '--output', 'b'],
      ['--org', ORG, '--case-manifest', 'a', '--output', 'b', '--apply', 'x'],
    ])
      expect(() => parseArgs(bad)).toThrow(CliAdmissionError);
  });
  it('requires private input and output locations', () => {
    expect(readPrivateJson(put('m.json', { a: 1 }))).toEqual({ a: 1 });
    expect(() => readPrivateJson(put('open.json', {}, 0o644))).toThrow(/not_private/);
    expect(() => readPrivateJson(join(dir, 'missing.json'))).toThrow(/unreadable/);
    writeFileSync(join(dir, 'bad.json'), '{', { mode: 0o600 });
    expect(() => readPrivateJson(join(dir, 'bad.json'))).toThrow(/invalid/);
    expect(admitOutputPath(join(dir, 'out.json'))).toBe(join(dir, 'out.json'));
    chmodSync(dir, 0o755);
    expect(() => admitOutputPath(join(dir, 'out.json'))).toThrow(/not_private/);
    chmodSync(dir, 0o700);
    expect(() => admitOutputPath(join(dir, 'nope', 'out.json'))).toThrow(/missing/);
  });
  it('publishes atomically with mode 0600 and rejects oversize without touching the old file', () => {
    const out = join(dir, 'r.json');
    writePrivateOutput(out, 'one');
    expect(statSync(out).mode & 0o777).toBe(0o600);
    expect(() => writePrivateOutput(out, 'x'.repeat(20_971_521))).toThrow(/too_large/);
    expect(readFileSync(out, 'utf8')).toBe('one');
    mkdirSync(join(dir, 'sub'));
  });
});

describe('authority matrix (stock has no field tier; finance tier gates cost)', () => {
  const caps = (
    over: Partial<Record<string, unknown>> = {},
    role: string | null = 'member',
  ): Authority => ({
    membershipRole: role,
    capabilities: {
      can: (m: string, a: string) =>
        (over.deny as string[] | undefined)?.includes(`${m}:${a}`) ? false : true,
      ownerScoped: (m: string) => (over.scoped as string[] | undefined)?.includes(m) ?? false,
      fieldLevel: (m: string) =>
        m === 'finance' ? ((over.finance as number | undefined) ?? 1) : 0,
    },
  });
  const mods = (off?: string) =>
    ['stock', 'pos', 'finances'].map((m) => ({ module_id: m, enabled: m !== off }));
  const m = decodeDiagnosticManifestV1(manifest());
  it('admits an ordinary role with finance tier and stock tier 0', () => {
    expect(() => checkDiagnosticAuthority(caps(), 1, mods(), m, ACTOR)).not.toThrow();
  });
  it.each([
    ['finance view denied', caps({ deny: ['finance:view'] }), mods()],
    ['stock view denied', caps({ deny: ['stock:view'] }), mods()],
    ['pos view denied', caps({ deny: ['pos:view'] }), mods()],
    ['finance tier too low', caps({ finance: 0 }), mods()],
    ['owner scoped', caps({ scoped: ['pos'] }), mods()],
    ['module off', caps(), mods('stock')],
  ])('refuses: %s', (_n, c, md) => {
    expect(() => checkDiagnosticAuthority(c, 1, md, m, ACTOR)).toThrow(CliAdmissionError);
  });
  it('asserted owner intent needs the real owner who is the verified principal', () => {
    const asserted = decodeDiagnosticManifestV1(
      manifest({
        cases: [
          {
            ...manifest().cases[0],
            evidenceRefs: [
              {
                referenceId: '44444444-4444-4444-8444-444444444444',
                kind: 'owner_attestation',
                sha256: 'a'.repeat(64),
                privateRef: 'doc',
                correctionId: null,
                assertion: {
                  kind: 'expected_component',
                  verifiedByProfileId: ACTOR,
                  verifiedAt: '2026-11-16T00:00:00.000Z',
                  component: {
                    source: { kind: 'booking', id: BOOKING },
                    itemId: BOOKING,
                    warehouseId: BOOKING,
                    intendedStockQty: '1.0000',
                    stockUom: 'unit',
                    fulfilled: true,
                    trueUpCoverage: 'not_covered',
                  },
                },
              },
            ],
          },
        ],
      }),
    );
    expect(() => checkDiagnosticAuthority(caps(), 1, mods(), asserted, ACTOR)).toThrow(
      /owner_required/,
    );
    expect(() =>
      checkDiagnosticAuthority(caps({}, 'owner'), 1, mods(), asserted, ACTOR),
    ).not.toThrow();
    expect(() =>
      checkDiagnosticAuthority(
        caps({}, 'owner'),
        1,
        mods(),
        asserted,
        '55555555-5555-4555-8555-555555555555',
      ),
    ).toThrow(/owner_required/);
  });
});

describe('run: refusals leave no output and never load the application graph', () => {
  const base = (m: string, o = join(dir, 'out.json')) => [
    '--org',
    ORG,
    '--case-manifest',
    m,
    '--output',
    o,
  ];
  it('exits 2 for invalid scope, manifest, missing env, identity mismatch and rejected token', async () => {
    const errs = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const good = put('good.json', manifest());
    expect(await run(['--org', ORG], env)).toBe(2);
    expect(await run(base(put('extra.json', { ...manifest(), apply: true })), env)).toBe(2);
    expect(await run(base(good), {})).toBe(2);
    expect(
      await run(base(good), {
        ...env,
        FACES_STOCK_DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/other',
      }),
    ).toBe(2);
    const { OperatorPrincipalError } = await import('./lib/operator-principal');
    verify.mockRejectedValue(new OperatorPrincipalError('token rejected'));
    expect(await run(base(good), env)).toBe(2);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(existsSync(join(dir, 'out.json'))).toBe(false);
    expect(loaderImported).not.toHaveBeenCalled();
    const logged = errs.mock.calls.flat().join('\n');
    expect(logged).not.toContain('postgres://');
    expect(logged).not.toContain(env.FACES_OPERATOR_ACCESS_TOKEN + 'x');
    errs.mockRestore();
  });
  it('a verified subject that differs from the manifest actor is refused by the shared verifier before business reads', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { OperatorPrincipalError } = await import('./lib/operator-principal');
    verify.mockRejectedValue(
      new OperatorPrincipalError('subject does not match the approved actor'),
    );
    expect(await run(base(put('g2.json', manifest())), env)).toBe(2);
    expect(verify.mock.calls[0][0]).toMatchObject({
      expectedProfileId: ACTOR,
      authUrl: AUTH.authUrl,
    });
  });
});
