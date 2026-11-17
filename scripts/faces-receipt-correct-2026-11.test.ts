import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { H, U, json, manifest } from '../src/server/services/faces-receipt-correction.test-fixture';
import {
  ReceiptCorrectionError,
  receiptManifestSha256,
} from '../src/server/services/faces-receipt-correction.logic';
import { operatorDatabaseIdentity } from './lib/operator-principal';
import {
  exitOf,
  parseCorrectArgs,
  runCorrect,
  type CorrectDeps,
} from './faces-receipt-correct-2026-11';
import { readPrivateFile, writePrivateFile } from './faces-receipt-valuation-2026-11';

const DB_URL = 'postgres://u:p@db.example.org:5432/hub';
const TARGET = {
  databaseIdentity: operatorDatabaseIdentity(DB_URL, 'proj'),
  authProject: 'proj',
  authUrl: 'https://auth.example.org',
};
const m = manifest({ target: TARGET });
const SHA = receiptManifestSha256(m);
const ACTOR = m.actorProfileId;

let dir: string;
let run: ReturnType<typeof vi.fn>;
let verifyPrincipal: ReturnType<typeof vi.fn>;
let deps: CorrectDeps;
const put = (name: string, data: unknown, mode = 0o600) => {
  writeFileSync(join(dir, name), typeof data === 'string' ? data : JSON.stringify(data));
  chmodSync(join(dir, name), mode);
};
const out = () => join(dir, 'out.json');
const common = () => ['--org', m.orgId, '--actor-user', ACTOR, '--output', out()];
const preview = () => [...common(), '--manifest', join(dir, 'm.json')];
const apply = () => [
  ...preview(),
  '--apply',
  '--approved-plan-sha256',
  SHA,
  '--preview-hash',
  H(9),
];
const status = () => [
  ...preview(),
  '--status',
  '--operation-key',
  m.operationKey,
  '--action',
  'correct',
  '--manifest-sha256',
  SHA,
];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'faces-correct-'));
  put('m.json', json(m));
  run = vi.fn(async () => ({ outcome: 'preview' }));
  verifyPrincipal = vi.fn(async () => ({
    profileId: ACTOR,
    authProject: 'proj',
    verifiedAt: '2026-11-17T00:00:00.000Z',
  }));
  deps = {
    env: {
      FACES_RECEIPT_DATABASE_URL: DB_URL,
      FACES_OPERATOR_ACCESS_TOKEN: 't',
      FACES_OPERATOR_ANON_KEY: 'k',
    },
    readFile: readPrivateFile,
    writeFile: writePrivateFile,
    verifyPrincipal: verifyPrincipal as never,
    run: run as never,
  };
});

describe('flag grammar', () => {
  it('accepts each mode with exactly its flags', () => {
    expect(parseCorrectArgs(preview()).mode).toBe('preview');
    expect(parseCorrectArgs(apply()).mode).toBe('apply');
    expect(parseCorrectArgs(status()).mode).toBe('status');
    expect(parseCorrectArgs([...common(), '--draft-input', 'x', '--draft']).mode).toBe('draft');
  });
  it.each([
    ['duplicate', () => [...preview(), '--org', U(1)]],
    ['unknown flag', () => [...preview(), '--force']],
    ['simultaneous status and apply', () => [...status(), '--apply']],
    ['apply without approval digest', () => [...preview(), '--apply']],
    ['status flag outside status mode', () => [...preview(), '--operation-key', U(3)]],
    [
      'bad action',
      () =>
        [...status().slice(0, -2), '--action', 'undo', '--manifest-sha256', SHA].filter(
          (x, i, a) => a.indexOf(x) === i,
        ),
    ],
    [
      'non-digest approval',
      () => [...preview(), '--apply', '--approved-plan-sha256', 'zz', '--preview-hash', H(9)],
    ],
    ['missing output', () => preview().slice(0, -8)],
  ])('refuses %s', (_n, args) => {
    expect(() => parseCorrectArgs(args())).toThrow();
  });
});

describe('admission before the business graph (exit 2, run never called)', () => {
  it.each([
    ['unknown flag', () => [...preview(), '--force']],
    ['mismatched org', () => ['--org', U(99), ...preview().slice(2)]],
    [
      'actor differs from the manifest actor on preview',
      () => [...preview().slice(0, 2), '--actor-user', U(77), ...preview().slice(4)],
    ],
  ])('%s', async (_n, args) => {
    expect(await runCorrect(args(), deps)).toBe(2);
    expect(run).not.toHaveBeenCalled();
  });
  it('invalid / group-readable manifest, absent private env, wrong database identity, rejected principal', async () => {
    put('m.json', { ...json(m), extra: 1 });
    expect(await runCorrect(preview(), deps)).toBe(2);
    put('m.json', json(m), 0o644);
    expect(await runCorrect(preview(), deps)).toBe(2);
    put('m.json', json(m));
    expect(await runCorrect(preview(), { ...deps, env: {} })).toBe(2); // an absent private DB variable stays refused even with other env present
    expect(
      await runCorrect(preview(), {
        ...deps,
        env: {
          ...deps.env,
          FACES_RECEIPT_DATABASE_URL: 'postgres://u:p@other.example.org:5432/hub',
        },
      }),
    ).toBe(2);
    verifyPrincipal.mockRejectedValueOnce(new Error('token rejected sk-secret'));
    expect(await runCorrect(preview(), deps)).toBe(2);
    expect(run).not.toHaveBeenCalled();
    expect(existsSync(out())).toBe(false);
  });
  it('apply with an approval digest that is not the manifest digest is refused before any run', async () => {
    const args = apply().map((x) => (x === SHA ? H(1) : x));
    expect(await runCorrect(args, deps)).toBe(2);
    expect(run).not.toHaveBeenCalled();
  });
  it('status with a wrong key, action or digest is refused', async () => {
    expect(
      await runCorrect(
        status().map((x) => (x === m.operationKey ? U(55) : x)),
        deps,
      ),
    ).toBe(2);
    expect(
      await runCorrect(
        status().map((x) => (x === 'correct' ? 'compensate' : x)),
        deps,
      ),
    ).toBe(2);
    expect(
      await runCorrect(
        status().map((x) => (x === SHA ? H(4) : x)),
        deps,
      ),
    ).toBe(2);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('modes, outcomes and exits', () => {
  it('preview writes a private credential-free result and exits 0', async () => {
    expect(await runCorrect(preview(), deps)).toBe(0);
    expect(run.mock.calls[0][0]).toMatchObject({ mode: 'preview', orgId: m.orgId });
    expect(statSync(out()).mode & 0o777).toBe(0o600);
    expect(readFileSync(out(), 'utf8')).not.toMatch(/FACES_|secret|postgres:\/\//);
  });
  it('apply passes the decoded command and exits 0 for applied and identical replay', async () => {
    run.mockResolvedValueOnce({ outcome: 'applied', replayed: true });
    expect(await runCorrect(apply(), deps)).toBe(0);
    expect(run.mock.calls[0][0]).toMatchObject({
      mode: 'apply',
      payload: { approvedPlanSha256: SHA, previewHash: H(9) },
    });
  });
  it('status exit table: applied 0, absent_before_unchanged 4, unknown 5; the reader may differ from the historical actor', async () => {
    for (const [outcome, exit] of [
      ['applied', 0],
      ['absent_before_unchanged', 4],
      ['unknown', 5],
    ] as const) {
      run.mockResolvedValueOnce({ outcome });
      const dirFile = join(dir, `s-${outcome}.json`);
      expect(
        await runCorrect(
          status().map((x) => (x === out() ? dirFile : x)),
          deps,
        ),
      ).toBe(exit);
    }
    const reader = U(88);
    verifyPrincipal.mockResolvedValueOnce({
      profileId: reader,
      authProject: 'proj',
      verifiedAt: 'x',
    });
    run.mockResolvedValueOnce({ outcome: 'applied' });
    const args = status()
      .map((x) => (x === ACTOR ? reader : x))
      .map((x) => (x === out() ? join(dir, 'reader.json') : x));
    expect(await runCorrect(args, deps)).toBe(0);
    expect(run.mock.calls.at(-1)![0].payload.actorProfileId).toBe(reader);
    expect(exitOf('status', { outcome: 'applied' })).toBe(0);
  });
  it.each([
    ['invalid_manifest', 2],
    ['read_unavailable', 3],
    ['stale_preview', 4],
    ['source_conflict', 4],
    ['period_unavailable', 4],
    ['invariant_failed', 4],
    ['commit_outcome_unknown', 5],
  ] as const)('typed service error %s exits %i without an output file', async (codeName, exit) => {
    run.mockRejectedValueOnce(new ReceiptCorrectionError(codeName));
    expect(await runCorrect(preview(), deps)).toBe(exit);
    expect(existsSync(out())).toBe(false);
  });
  it('draft mode runs the producer from a private input and writes the manifest', async () => {
    put('d.json', {
      action: 'compensate',
      target: TARGET,
      sourceCodeSha: 'a'.repeat(40),
      operationKey: U(3),
      inverseOfOperationId: U(9),
      postedAt: '2026-11-17T15:00:00.000Z',
      reason: 'undo',
      ownerApprovalReference: 'ok',
      replacementIds: null,
    });
    run.mockResolvedValueOnce({ outcome: 'draft', manifest: json(m) });
    expect(
      await runCorrect([...common(), '--draft-input', join(dir, 'd.json'), '--draft'], deps),
    ).toBe(0);
    expect(run.mock.calls[0][0]).toMatchObject({ mode: 'draft', input: { action: 'compensate' } });
    put('d.json', { action: 'correct', extra: 1 });
    expect(
      await runCorrect(
        [
          ...common(),
          '--draft-input',
          join(dir, 'd.json'),
          '--draft',
          '--output',
          join(dir, 'x.json'),
        ].filter((x, i, a) => a.indexOf(x) === i),
        deps,
      ),
    ).toBe(2);
  });
  it('an output path that already exists is a failure (exit 3), never a clobber', async () => {
    writeFileSync(out(), 'keep', { mode: 0o600 });
    expect(await runCorrect(preview(), deps)).toBe(3);
    expect(readFileSync(out(), 'utf8')).toBe('keep');
  });
});
