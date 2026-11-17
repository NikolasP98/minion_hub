/**
 * FACES receipt-chain correction operator CLI (minion-meta spec 123, contracts/command-envelope.md).
 *
 *   preview (default):  --org U --actor-user U --manifest P --output P
 *   apply:              preview flags + --apply --approved-plan-sha256 D --preview-hash D      (OWNER ACTION on production)
 *   status:             preview flags + --status --operation-key U --action correct|compensate --manifest-sha256 D
 *   draft (producer):   --org U --actor-user U --draft-input P --output P --draft            (writes an unsigned manifest; no writes)
 *
 * Private env only: FACES_RECEIPT_DATABASE_URL, FACES_OPERATOR_ACCESS_TOKEN, FACES_OPERATOR_ANON_KEY.
 * Exit: 0 ok | 2 admission | 3 incomplete | 4 refused/stale/status absent | 5 unknown outcome.
 */
import postgres from 'postgres';
import {
  RECEIPT_CORRECTION_EXIT,
  ReceiptCorrectionError,
  decodeReceiptChainManifestV1,
  decodeReceiptCorrectionCommand,
  decodeReceiptCorrectionStatusInput,
  receiptManifestSha256,
  type ReceiptChainManifestV1,
} from '../src/server/services/faces-receipt-correction.logic';
import { parseStrictJson, wire } from './lib/faces-receipt-replay';
import {
  operatorDatabaseIdentity,
  verifyOperatorPrincipal,
  type VerifiedOperatorPrincipal,
} from './lib/operator-principal';
import { CliError, readPrivateFile, writePrivateFile } from './faces-receipt-valuation-2026-11';

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST_RX = /^[0-9a-f]{64}$/;
const DISPOSABLE_MARKER = 'minion-360-disposable:v1';

export type Mode = 'preview' | 'apply' | 'status' | 'draft';
export type CorrectArgs = {
  mode: Mode;
  org: string;
  actorUser: string;
  manifest: string | null;
  draftInput: string | null;
  output: string;
  approvedPlanSha256: string | null;
  previewHash: string | null;
  operationKey: string | null;
  action: 'correct' | 'compensate' | null;
  manifestSha256: string | null;
};

const VALUE_FLAGS = {
  '--org': 'org',
  '--actor-user': 'actorUser',
  '--manifest': 'manifest',
  '--draft-input': 'draftInput',
  '--output': 'output',
  '--approved-plan-sha256': 'approvedPlanSha256',
  '--preview-hash': 'previewHash',
  '--operation-key': 'operationKey',
  '--action': 'action',
  '--manifest-sha256': 'manifestSha256',
} as const;
const MODE_FLAGS = { '--apply': 'apply', '--status': 'status', '--draft': 'draft' } as const;
const REQUIRED: Record<Mode, readonly (keyof typeof VALUE_FLAGS)[]> = {
  preview: ['--org', '--actor-user', '--manifest', '--output'],
  apply: [
    '--org',
    '--actor-user',
    '--manifest',
    '--output',
    '--approved-plan-sha256',
    '--preview-hash',
  ],
  status: [
    '--org',
    '--actor-user',
    '--manifest',
    '--output',
    '--operation-key',
    '--action',
    '--manifest-sha256',
  ],
  draft: ['--org', '--actor-user', '--draft-input', '--output'],
};

/** Closed flag grammar: duplicates, unknown flags, missing or foreign-mode flags and simultaneous modes are refused. */
export function parseCorrectArgs(argv: readonly string[]): CorrectArgs {
  const bad = () => new CliError(2, 'invalid_arguments');
  const seen = new Map<string, string>();
  const modes: Mode[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a in MODE_FLAGS) {
      const m = MODE_FLAGS[a as keyof typeof MODE_FLAGS];
      if (modes.includes(m)) throw bad();
      modes.push(m);
    } else if (a in VALUE_FLAGS) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--') || seen.has(a)) throw bad();
      seen.set(a, v);
      i += 1;
    } else throw bad();
  }
  if (modes.length > 1) throw bad();
  const mode: Mode = modes[0] ?? 'preview';
  const allowed = new Set<string>(REQUIRED[mode]);
  for (const k of seen.keys()) if (!allowed.has(k)) throw bad();
  for (const k of REQUIRED[mode]) if (!seen.has(k)) throw bad();
  const g = (k: keyof typeof VALUE_FLAGS) => seen.get(k) ?? null;
  const out: CorrectArgs = {
    mode,
    org: g('--org')!,
    actorUser: g('--actor-user')!,
    manifest: g('--manifest'),
    draftInput: g('--draft-input'),
    output: g('--output')!,
    approvedPlanSha256: g('--approved-plan-sha256'),
    previewHash: g('--preview-hash'),
    operationKey: g('--operation-key'),
    action: g('--action') as CorrectArgs['action'],
    manifestSha256: g('--manifest-sha256'),
  };
  for (const u of [out.org, out.actorUser, out.operationKey])
    if (u !== null && !UUID_RX.test(u)) throw bad();
  for (const d of [out.approvedPlanSha256, out.previewHash, out.manifestSha256])
    if (d !== null && !DIGEST_RX.test(d)) throw bad();
  if (out.action !== null && out.action !== 'correct' && out.action !== 'compensate') throw bad();
  return out;
}

const { obj, lit, uuid, utc, label, codeSha, str, arr, union, nul } = wire;
const draftInputV = union<Record<string, unknown>>('action', {
  correct: obj({
    action: lit('correct'),
    target: wire.target,
    sourceCodeSha: codeSha,
    operationKey: uuid,
    receiptEntryId: uuid,
    receiptLineId: uuid,
    basis: ((x: unknown) => x) as never,
    postedAt: utc,
    reason: label(1, 1000),
    ownerApprovalReference: label(1, 1000),
    replacementIds: nul(arr(uuid, 129)),
  }) as never,
  compensate: obj({
    action: lit('compensate'),
    target: wire.target,
    sourceCodeSha: codeSha,
    operationKey: uuid,
    inverseOfOperationId: uuid,
    postedAt: utc,
    reason: label(1, 1000),
    ownerApprovalReference: label(1, 1000),
    replacementIds: nul(arr(uuid, 129)),
  }) as never,
});
void str;

type RequestBody =
  | { mode: 'draft'; input: Record<string, unknown> }
  | { mode: 'preview' | 'apply' | 'status'; payload: unknown };
export type RunRequest = RequestBody & {
  databaseUrl: string;
  principal: VerifiedOperatorPrincipal;
  target: ReceiptChainManifestV1['target'];
  orgId: string;
};

export type CorrectDeps = {
  env: Readonly<Record<string, string | undefined>>;
  readFile(path: string): string;
  writeFile(path: string, text: string): void;
  verifyPrincipal: typeof verifyOperatorPrincipal;
  /** Business graph + owned database: only reached after argument, target and principal admission. */
  run(request: RunRequest): Promise<{ outcome: string; [k: string]: unknown }>;
};

/** Exit per the single CLI outcome table. */
export function exitOf(mode: Mode, result: { outcome: string }): number {
  if (mode === 'status')
    return result.outcome === 'applied' ? 0 : result.outcome === 'absent_before_unchanged' ? 4 : 5;
  return 0;
}

export async function runCorrect(argv: readonly string[], deps: CorrectDeps): Promise<number> {
  try {
    const a = parseCorrectArgs(argv);
    const read = (p: string) => {
      try {
        return deps.readFile(p);
      } catch (e) {
        throw e instanceof CliError ? e : new CliError(2, 'invalid_manifest');
      }
    };
    let target: ReceiptChainManifestV1['target'];
    let request: RequestBody;
    let expectedProfile: string;
    if (a.mode === 'draft') {
      let input: Record<string, unknown>;
      try {
        input = draftInputV(parseStrictJson(read(a.draftInput!)), '$');
      } catch {
        throw new CliError(2, 'invalid_manifest');
      }
      target = input.target as typeof target;
      expectedProfile = a.actorUser;
      request = { mode: 'draft', input };
    } else {
      let m: ReceiptChainManifestV1;
      try {
        m = decodeReceiptChainManifestV1(parseStrictJson(read(a.manifest!)));
      } catch {
        throw new CliError(2, 'invalid_manifest');
      }
      if (m.orgId !== a.org) throw new CliError(2, 'target_mismatch');
      // preview/apply act as the manifest actor; status names the CURRENT reader and never rewrites the historical actor
      if (a.mode !== 'status' && m.actorProfileId !== a.actorUser)
        throw new CliError(2, 'target_mismatch');
      target = m.target;
      expectedProfile = a.actorUser;
      if (a.mode === 'preview') request = { mode: 'preview', payload: m };
      else if (a.mode === 'apply') {
        let command;
        try {
          command = decodeReceiptCorrectionCommand({
            manifest: m,
            approvedPlanSha256: a.approvedPlanSha256,
            previewHash: a.previewHash,
          });
        } catch {
          throw new CliError(2, 'invalid_manifest');
        }
        request = { mode: 'apply', payload: command };
      } else {
        if (
          m.operationKey !== a.operationKey ||
          m.action !== a.action ||
          receiptManifestSha256(m) !== a.manifestSha256
        )
          throw new CliError(2, 'target_mismatch');
        request = {
          mode: 'status',
          payload: decodeReceiptCorrectionStatusInput({
            target: m.target,
            orgId: m.orgId,
            actorProfileId: a.actorUser,
            operationKey: a.operationKey,
            action: a.action,
            manifestSha256: a.manifestSha256,
            manifest: m,
          }),
        };
      }
    }
    const url = deps.env.FACES_RECEIPT_DATABASE_URL;
    const token = deps.env.FACES_OPERATOR_ACCESS_TOKEN;
    const anon = deps.env.FACES_OPERATOR_ANON_KEY;
    if (!url || !token || !anon) throw new CliError(2, 'actor_unavailable');
    let identity: string;
    try {
      identity = operatorDatabaseIdentity(url, target.authProject);
    } catch {
      throw new CliError(2, 'target_mismatch');
    }
    if (identity !== target.databaseIdentity) throw new CliError(2, 'target_mismatch');
    let principal: VerifiedOperatorPrincipal;
    try {
      principal = await deps.verifyPrincipal({
        accessToken: token,
        authUrl: target.authUrl,
        anonKey: anon,
        expectedProfileId: expectedProfile,
        targetFingerprint: target,
      });
    } catch {
      throw new CliError(2, 'actor_unavailable');
    }
    const result = await deps.run({
      ...request,
      databaseUrl: url,
      principal,
      target,
      orgId: a.org,
    } as RunRequest);
    deps.writeFile(a.output, `${JSON.stringify(result)}\n`);
    return exitOf(a.mode, result);
  } catch (e) {
    if (e instanceof CliError) return e.exit;
    if (e instanceof ReceiptCorrectionError) return RECEIPT_CORRECTION_EXIT[e.code];
    return 3;
  }
}

// ───────────── real wiring (package command only) ─────────────
// TODO(handoff): not run end to end against a real GoTrue/target (owner action); the loader graph and the service are proved by
// operator-service-loader.test.ts and the qa-native suite, and every port is unit-tested here.
async function realRun(req: RunRequest) {
  const host = new URL(req.databaseUrl).hostname.toLowerCase();
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
  const client = postgres(req.databaseUrl, {
    max: 1,
    prepare: false,
    onnotice: () => undefined,
    ssl: loopback ? false : { rejectUnauthorized: true },
  });
  const { createOperatorServiceLoader } = await import('./lib/operator-service-loader');
  const loader = await createOperatorServiceLoader({
    principal: req.principal,
    target: req.target,
  });
  try {
    const [db] = await client.unsafe(
      `select current_database() db, shobj_description((select oid from pg_database where datname=current_database()),'pg_database') marker`,
    );
    if (
      new URL(req.databaseUrl).pathname.slice(1) !== db.db ||
      (loopback && db.marker !== DISPOSABLE_MARKER)
    )
      throw new CliError(2, 'target_mismatch');
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const svc = await loader.load('receiptCorrection');
    const ctx = {
      db: drizzle(client),
      tenantId: req.orgId,
      profileId: req.principal.profileId,
    } as never;
    const actor = { id: req.principal.profileId, name: 'operator' };
    if (req.mode === 'draft') {
      const i = req.input as Record<string, unknown> & { replacementIds: string[] | null };
      const input = { ...i, replacementIds: i.replacementIds ?? undefined } as never;
      return {
        outcome: 'draft',
        manifest:
          i.action === 'compensate'
            ? await svc.draftReceiptCompensationManifest(ctx, input)
            : await svc.draftReceiptCorrectionManifest(ctx, input),
      };
    }
    if (req.mode === 'preview') return await svc.previewReceiptCorrection(ctx, req.payload);
    if (req.mode === 'apply') return await svc.applyReceiptCorrection(ctx, req.payload, actor);
    return await svc.getReceiptCorrectionStatus(ctx, req.payload);
  } finally {
    await loader.close().catch(() => undefined);
    await client.end({ timeout: 5 }).catch(() => undefined);
  }
}

if (import.meta.main) {
  void (async () => {
    process.exitCode = await runCorrect(process.argv.slice(2), {
      env: process.env,
      readFile: readPrivateFile,
      writeFile: writePrivateFile,
      verifyPrincipal: verifyOperatorPrincipal,
      run: realRun,
    });
  })();
}
