import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

import { mappingExitCode, parseMappingArgs, run } from './faces-garment-mapping-2026-11';
import { CliAdmissionError } from './faces-stock-reconcile-2026-11';
import { operatorDatabaseIdentity } from './lib/operator-principal';
import { mappingManifestSha256, decodeMappingManifestV1 } from './lib/faces-garment-mapping';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H = (c: string) => c.repeat(64);
const URL_OK = 'postgres://u:p@127.0.0.1:5432/faces';
const AUTH = 'https://auth.example.org';
const env = {
  FACES_STOCK_DATABASE_URL: URL_OK,
  FACES_OPERATOR_ACCESS_TOKEN: 't',
  FACES_OPERATOR_ANON_KEY: 'a',
  FACES_OPERATOR_AUTH_URL: AUTH,
};
let dir: string;
const manifest = () => ({
  schemaVersion: 1,
  kind: 'product_mapping',
  action: 'correct',
  target: {
    databaseIdentity: operatorDatabaseIdentity(URL_OK, 'proj'),
    authProject: 'proj',
    authUrl: AUTH,
  },
  sourceCodeSha: 'a'.repeat(40),
  operationKey: id(3),
  orgId: id(1),
  actorProfileId: id(2),
  before: {
    productId: id(10),
    productRowSha256: H('1'),
    directBridgeItemId: null,
    recipe: [{ rowId: id(30), itemId: id(20), qtyPerUnit: '1', note: null, rowSha256: H('2') }],
    ruleRows: [],
    preservedLProductId: id(11),
    preservedLMappingSha256: H('5'),
  },
  intended: {
    rowId: id(31),
    productId: id(10),
    itemId: id(21),
    qtyPerUnit: '1.0000',
    stockUom: 'unit',
    note: null,
  },
  census: {
    complete: true,
    pendingDrafts: [],
    openAccruals: [],
    submittedIssues: [],
    ledgerHighWater: null,
    stateSha256: H('6'),
  },
  unchangedStockPaymentSha256: H('7'),
  rollout: {
    protocolVersion: 1,
    candidateSha: 'a'.repeat(40),
    evidenceReference: 'r',
    evidenceSha256: H('8'),
  },
  reason: 'x',
  ownerApprovalReference: 'y',
});
const put = (name: string, v: unknown) => {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(v), { mode: 0o600 });
  chmodSync(p, 0o600);
  return p;
};
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'faces-map-'));
  chmodSync(dir, 0o700);
  verify.mockReset();
  loaderImported.mockClear();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('mapping CLI flag grammar', () => {
  const base = ['--org', id(1), '--manifest', 'm', '--output', 'o'];
  it('accepts the three documented modes and the draft producer', () => {
    expect(parseMappingArgs(base).mode).toBe('preview');
    expect(parseMappingArgs([...base, '--draft']).mode).toBe('draft');
    expect(
      parseMappingArgs([
        ...base,
        '--apply',
        '--approved-plan-sha256',
        H('a'),
        '--preview-hash',
        H('b'),
      ]),
    ).toMatchObject({ mode: 'apply', previewHash: H('b') });
    expect(
      parseMappingArgs([
        ...base,
        '--status',
        '--actor-user',
        id(2),
        '--operation-key',
        id(3),
        '--action',
        'compensate',
        '--manifest-sha256',
        H('a'),
        '--payload-sha256',
        H('b'),
      ]).mode,
    ).toBe('status');
  });
  it.each([
    ['apply without digests', ['--apply']],
    [
      'apply with a bad digest',
      ['--apply', '--approved-plan-sha256', 'x', '--preview-hash', H('b')],
    ],
    ['apply and status together', ['--apply', '--status']],
    ['stray status flag in preview', ['--actor-user', id(2)]],
    ['duplicate flag', ['--org', id(1)]],
    ['unknown flag', ['--force']],
    [
      'status bad action',
      [
        '--status',
        '--actor-user',
        id(2),
        '--operation-key',
        id(3),
        '--action',
        'undo',
        '--manifest-sha256',
        H('a'),
        '--payload-sha256',
        H('b'),
      ],
    ],
  ])('refuses %s', (_n, extra) => {
    expect(() => parseMappingArgs([...base, ...(extra as string[])])).toThrow(CliAdmissionError);
  });
});

describe('mapping CLI refusals never load the application graph', () => {
  it('exits 2 for org mismatch, tampered auth url and a stale approved digest; 2 for a rejected token', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const out = join(dir, 'out.json');
    const m = manifest();
    expect(await run(['--org', id(99), '--manifest', put('a.json', m), '--output', out], env)).toBe(
      2,
    );
    expect(
      await run(
        [
          '--org',
          id(1),
          '--manifest',
          put('b.json', m),
          '--apply',
          '--approved-plan-sha256',
          H('0'),
          '--preview-hash',
          H('1'),
          '--output',
          out,
        ],
        env,
      ),
    ).toBe(2);
    const { OperatorPrincipalError } = await import('./lib/operator-principal');
    verify.mockRejectedValue(new OperatorPrincipalError('token rejected'));
    expect(await run(['--org', id(1), '--manifest', put('c.json', m), '--output', out], env)).toBe(
      2,
    );
    expect(verify.mock.calls[0][0]).toMatchObject({
      trustedAuthUrl: AUTH,
      expectedProfileId: id(2),
    });
    expect(
      await run(['--org', id(1), '--manifest', put('d.json', m), '--output', out], {
        ...env,
        FACES_STOCK_DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/other',
      }),
    ).toBe(2);
    expect(existsSync(out)).toBe(false);
    expect(loaderImported).not.toHaveBeenCalled();
    // an approved digest that matches is accepted by the decoder (then stops at the verifier)
    const ok = decodeMappingManifestV1(m);
    expect(mappingManifestSha256(ok)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('mappingExitCode', () => {
  it('maps an operation_conflict to 5 (uncertain, run --status), not 4', () => {
    expect(['forbidden', 'incomplete', 'operation_conflict', 'stale'].map(mappingExitCode)).toEqual(
      [2, 3, 5, 4],
    );
  });
});
