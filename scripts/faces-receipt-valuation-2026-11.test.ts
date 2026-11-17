import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as stockLogic from '../src/server/services/stock.logic';
import { operatorDatabaseIdentity } from './lib/operator-principal';
import {
  parseArgs,
  readPrivateFile,
  runDiagnose,
  writePrivateFile,
  type CliDeps,
  type SnapshotResult,
} from './faces-receipt-valuation-2026-11';

const U = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const H = (n: number) => n.toString(16).padStart(64, '0');
const ORG = U(1);
const ENTRY = U(2);
const LINE = U(3);
const ACTOR = U(4);
const DB_URL = 'postgres://u:p@db.example.org:5432/hub';
const TARGET = {
  databaseIdentity: operatorDatabaseIdentity(DB_URL, 'proj'),
  authProject: 'proj',
  authUrl: 'https://auth.example.org',
};
const manifest = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  kind: 'receipt_diagnostic',
  target: TARGET,
  sourceCodeSha: 'a'.repeat(40),
  orgId: ORG,
  actorProfileId: ACTOR,
  receiptEntryId: ENTRY,
  receiptLineId: LINE,
  approvalReference: 'ref',
  document: { state: 'absent' },
  unitQualification: null,
  hypothesis: null,
  residualAccepted: false,
  ...over,
});

const hdr = {
  id: ENTRY,
  humanId: null,
  type: 'receipt',
  status: 'submitted',
  postedAt: '2026-05-01T00:00:00.000Z',
  rowSha256: H(1),
  purchaseId: { state: 'missing', value: null },
  providerRef: { state: 'missing', value: null },
  currency: { state: 'missing', value: null },
  fxRate: { state: 'missing', value: null },
  fxUpdatedAt: { state: 'missing', value: null },
} as const;
const line = {
  id: LINE,
  entryId: ENTRY,
  itemId: U(5),
  qty: '5',
  uom: null,
  rate: '2',
  fromWarehouseId: null,
  toWarehouseId: U(6),
  lineNo: 1,
  rowSha256: H(2),
};
function snapshot(over: Partial<SnapshotResult['coverage']> = {}): SnapshotResult {
  return {
    snapshotId: 'snap',
    source: {
      receipt: hdr,
      line,
      item: {
        id: U(5),
        rowSha256: H(3),
        stockUom: 'U',
        consumptionUom: null,
        unitsPerStockUom: null,
      },
      warehouse: { id: U(6), rowSha256: H(4) },
      bin: { rowSha256: H(5), qty: '5', rate: '2' },
      opening: {
        state: 'empty_verified',
        priorLedgerId: null,
        priorRowSha256: null,
        qty: '0',
        rate: '0',
        valueEngine: '0',
      },
      context: [],
      affected: [
        {
          id: '10',
          entryId: ENTRY,
          itemId: U(5),
          warehouseId: U(6),
          postedAt: '2026-05-01T00:00:00.000Z',
          qtyDelta: '5',
          valueDelta: '10',
          qtyAfter: '5',
          valuationRate: '2',
          rowSha256: H(6),
          header: hdr,
          lines: [line],
          source: { kind: 'receipt', id: ENTRY },
          reversalOfLedgerId: null,
        },
      ],
      boundary: null,
      consumers: [],
    },
    coverage: {
      readsComplete: true,
      contextComplete: true,
      affectedComplete: true,
      consumersComplete: true,
      baselineComplete: false,
      hypotheticalComplete: false,
      contextCount: 0,
      affectedCount: 1,
      consumerCount: 0,
      contextReadCount: 0,
      affectedReadCount: 1,
      consumerReadCount: 0,
      lastReadLedgerId: '10',
      latestSameKeyLedgerId: '10',
      maxObservedLedgerId: '10',
      ...over,
    },
  };
}

let dir: string;
let deps: CliDeps;
let readSnapshot: ReturnType<typeof vi.fn>;
let loadMath: ReturnType<typeof vi.fn>;
let verifyPrincipal: ReturnType<typeof vi.fn>;
const writes: string[] = [];
const argv = (o: Record<string, string> = {}) => {
  const f = {
    '--org': ORG,
    '--entry': ENTRY,
    '--line': LINE,
    '--evidence-manifest': join(dir, 'm.json'),
    '--output': join(dir, 'out.json'),
    ...o,
  };
  return Object.entries(f).flat();
};
const putManifest = (m: unknown, mode = 0o600) => {
  writeFileSync(join(dir, 'm.json'), JSON.stringify(m));
  chmodSync(join(dir, 'm.json'), mode);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'faces-diag-'));
  writes.length = 0;
  readSnapshot = vi.fn(async () => snapshot());
  loadMath = vi.fn(async () => ({
    computeLegValue: stockLogic.computeLegValue,
    applyLedgerDelta: stockLogic.applyLedgerDelta,
    round4: stockLogic.round4,
  }));
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
      FACES_OPERATOR_AUTH_URL: 'https://auth.example.org',
    },
    readFile: readPrivateFile,
    writeFile: (p, t) => (writes.push(t), writePrivateFile(p, t)),
    verifyPrincipal: verifyPrincipal as never,
    readSnapshot: readSnapshot as never,
    loadMath: loadMath as never,
    now: () => new Date('2026-11-17T00:00:00Z'),
  };
  putManifest(manifest());
});

describe('argument and admission refusals (exit 2, zero business reads, zero writes)', () => {
  const noWork = () => {
    expect(loadMath).not.toHaveBeenCalled();
    expect(readSnapshot).not.toHaveBeenCalled();
    expect(existsSync(join(dir, 'out.json'))).toBe(false);
  };
  it.each([
    ['missing flag', () => ['--org', ORG]],
    ['unknown flag', () => [...argv(), '--apply', 'x']],
    ['apply-looking flag', () => [...argv(), '--apply']],
    ['duplicate flag', () => [...argv(), '--org', ORG]],
    ['non-uuid id', () => argv({ '--entry': 'nope' })],
  ])('%s', async (_n, args) => {
    expect(await runDiagnose(args(), deps)).toBe(2);
    noWork();
  });
  it('identity flags must equal the manifest', async () => {
    expect(await runDiagnose(argv({ '--line': U(99) }), deps)).toBe(2);
    expect(await runDiagnose(argv({ '--org': U(98) }), deps)).toBe(2);
    noWork();
  });
  it('invalid, duplicate-key, group-readable and missing manifests', async () => {
    putManifest({ ...manifest(), extra: 1 });
    expect(await runDiagnose(argv(), deps)).toBe(2);
    writeFileSync(join(dir, 'm.json'), '{"schemaVersion":1,"schemaVersion":1}', { mode: 0o600 });
    expect(await runDiagnose(argv(), deps)).toBe(2);
    putManifest(manifest(), 0o644);
    expect(await runDiagnose(argv(), deps)).toBe(2);
    expect(
      await runDiagnose(argv({ '--evidence-manifest': join(dir, 'missing.json') }), deps),
    ).toBe(2);
    noWork();
  });
  it('wrong database target, absent private env, rejected principal', async () => {
    putManifest(manifest({ target: { ...TARGET, databaseIdentity: H(9) } }));
    expect(await runDiagnose(argv(), deps)).toBe(2);
    putManifest(manifest());
    expect(await runDiagnose(argv(), { ...deps, env: {} })).toBe(2);
    expect(
      await runDiagnose(argv(), {
        ...deps,
        env: {
          ...deps.env,
          FACES_RECEIPT_DATABASE_URL: 'postgres://u:p@other.example.org:5432/hub',
        },
      }),
    ).toBe(2);
    verifyPrincipal.mockRejectedValueOnce(new Error('token rejected sk-secret'));
    expect(await runDiagnose(argv(), deps)).toBe(2);
    noWork();
  });
  it('an attestor other than the executing owner is refused before any read', async () => {
    const attested = manifest({
      document: {
        state: 'owner_attested',
        verifiedByProfileId: U(77),
        verifiedAt: '2026-11-16T00:00:00.000Z',
        approvalReference: 'x',
        facts: {
          reference: 'r',
          documentLineReference: 'l',
          sha256: H(1),
          purchaseId: null,
          providerRef: null,
          quantity: '5',
          uom: 'U',
          allocation: {
            policy: 'single_line',
            net: '10',
            tax: '0',
            freight: '0',
            discount: '0',
            inventoryCost: '10',
            evidenceSha256: H(2),
          },
          fx: {
            sourceCurrency: 'PEN',
            valuationCurrency: 'PEN',
            rate: '1',
            effectiveAt: '2026-05-01T00:00:00.000Z',
            sourceInventoryCost: '10',
            totalValuation: '10',
            conversionResidual: '0',
            historicalValuationCurrencyEvidenceSha256: H(3),
            evidenceSha256: H(4),
          },
        },
      },
    });
    putManifest(attested);
    expect(await runDiagnose(argv(), deps)).toBe(2);
    noWork();
  });
});

describe('results, exits and private output', () => {
  it('complete (absent invoice) exits 0 and writes a strict 0600 report with credential-free content', async () => {
    expect(await runDiagnose(argv(), deps)).toBe(0);
    const out = join(dir, 'out.json');
    expect(statSync(out).mode & 0o777).toBe(0o600);
    const text = readFileSync(out, 'utf8');
    expect(text).not.toMatch(/FACES_|sk-|secret|postgres:\/\//);
    const report = JSON.parse(text);
    expect(report.result.eligible).toBe(false);
    expect(report.result.readOnly).toBe(true);
    expect(report.result.basisChoice).toBeNull();
    expect(readSnapshot).toHaveBeenCalledTimes(1);
  });
  it('an explicit hypothesis exits 0 as hypothetical, still never eligible', async () => {
    putManifest(
      manifest({
        hypothesis: {
          stockQty: '5',
          stockUom: 'U',
          valuationCurrency: 'PEN',
          totalValuation: '10',
        },
      }),
    );
    expect(await runDiagnose(argv(), deps)).toBe(0);
    const report = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'));
    expect(report.result.mode).toBe('hypothetical_replay');
    expect(report.result.eligible).toBe(false);
  });
  it('read/schema failure and timeout are exit 3 without a report', async () => {
    readSnapshot.mockRejectedValueOnce(new Error('relation missing'));
    expect(await runDiagnose(argv(), deps)).toBe(3);
    expect(existsSync(join(dir, 'out.json'))).toBe(false);
  });
  it('incomplete coverage is exit 3 and publishes only original evidence', async () => {
    readSnapshot.mockResolvedValueOnce(snapshot({ contextComplete: false }));
    expect(await runDiagnose(argv(), deps)).toBe(3);
    const report = JSON.parse(readFileSync(join(dir, 'out.json'), 'utf8'));
    expect(report.result.complete).toBe(false);
  });
  it('unsupported history is exit 4', async () => {
    const s = snapshot();
    s.source.affected[0].header = { ...hdr, type: 'transfer' } as never;
    s.source.affected[0].source = { kind: 'unknown', id: null };
    readSnapshot.mockResolvedValueOnce(s);
    const code = await runDiagnose(argv(), deps);
    expect(code).toBe(4);
  });
  it('output failure (existing path) is exit 3 and never clobbers', async () => {
    writeFileSync(join(dir, 'out.json'), 'keep', { mode: 0o600 });
    expect(await runDiagnose(argv(), deps)).toBe(3);
    expect(readFileSync(join(dir, 'out.json'), 'utf8')).toBe('keep');
  });
  it('parseArgs requires every flag exactly once', () => {
    expect(parseArgs(argv())).toMatchObject({ org: ORG, entry: ENTRY, line: LINE });
    expect(() => parseArgs([])).toThrow();
  });
});
