#!/usr/bin/env bun
/**
 * Faja M mapping correction operator wrapper (minion-meta spec 122, contracts/mapping-envelope.md). Dry-run by default.
 *   preview : --org <uuid> --manifest <path> --output <path>
 *   apply   : preview flags + --apply --approved-plan-sha256 <digest> --preview-hash <digest>
 *   status  : --status --org --manifest --actor-user <uuid> --operation-key <uuid> --action correct|compensate
 *             --manifest-sha256 <digest> --payload-sha256 <digest> --output
 *   draft   : --draft --org <uuid> --manifest <draft-input.json> --output <path>   (read-only manifest producer)
 * Private env: FACES_STOCK_DATABASE_URL, FACES_OPERATOR_ACCESS_TOKEN, FACES_OPERATOR_ANON_KEY, FACES_OPERATOR_AUTH_URL.
 * Exit: 0 eligible preview / applied / replayed / applied status; 2 invalid arguments, authentication or target;
 * 3 incomplete read; 4 blocked, stale, key conflict, absent_before_unchanged; 5 transport/commit uncertainty or unknown status.
 */
import {
  canonicalJson,
  UUID_RE,
  DIGEST_RE,
  ReconciliationError,
} from './lib/faces-stock-reconciliation';
import {
  decodeMappingCommand,
  decodeMappingManifestV1,
  decodeMappingStatusInput,
} from './lib/faces-garment-mapping';
import {
  CliAdmissionError,
  admitOutputPath,
  readPrivateJson,
  writePrivateOutput,
} from './faces-stock-reconcile-2026-11';
import { openOperatorSession, SessionRefusal } from './lib/faces-operator-session';

export type Mode = 'preview' | 'apply' | 'status' | 'draft';
export interface MappingArgs {
  mode: Mode;
  org: string;
  manifestPath: string;
  outputPath: string;
  approvedPlanSha256?: string;
  previewHash?: string;
  actorUser?: string;
  operationKey?: string;
  action?: 'correct' | 'compensate';
  manifestSha256?: string;
  payloadSha256?: string;
}
const VALUE_FLAGS = [
  '--org',
  '--manifest',
  '--output',
  '--approved-plan-sha256',
  '--preview-hash',
  '--actor-user',
  '--operation-key',
  '--action',
  '--manifest-sha256',
  '--payload-sha256',
];
const BOOL_FLAGS = ['--apply', '--status', '--draft'];

/** Exact flag grammar; missing, unknown, duplicate, valueless or mixed flags refuse before any import or read. */
export function parseMappingArgs(argv: readonly string[]): MappingArgs {
  const v = new Map<string, string>();
  const b = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const f = argv[i];
    if (BOOL_FLAGS.includes(f)) {
      if (b.has(f)) throw new CliAdmissionError('invalid_arguments');
      b.add(f);
    } else if (VALUE_FLAGS.includes(f)) {
      const x = argv[i + 1];
      if (x === undefined || x.startsWith('--') || v.has(f))
        throw new CliAdmissionError('invalid_arguments');
      v.set(f, x);
      i += 1;
    } else throw new CliAdmissionError('invalid_arguments');
  }
  if (b.size > 1) throw new CliAdmissionError('invalid_arguments'); // --apply, --status, --draft are mutually exclusive
  const need = (f: string) =>
    v.get(f) ??
    (() => {
      throw new CliAdmissionError('invalid_arguments');
    })();
  const org = need('--org');
  if (!UUID_RE.test(org)) throw new CliAdmissionError('invalid_arguments');
  const base = { org, manifestPath: need('--manifest'), outputPath: need('--output') };
  const only = (allowed: string[]) => {
    for (const f of v.keys())
      if (!['--org', '--manifest', '--output', ...allowed].includes(f))
        throw new CliAdmissionError('invalid_arguments');
  };
  const digest = (f: string) =>
    DIGEST_RE.test(need(f))
      ? need(f)
      : (() => {
          throw new CliAdmissionError('invalid_arguments');
        })();
  const uuid = (f: string) =>
    UUID_RE.test(need(f))
      ? need(f)
      : (() => {
          throw new CliAdmissionError('invalid_arguments');
        })();
  if (b.has('--apply')) {
    only(['--approved-plan-sha256', '--preview-hash']);
    return {
      mode: 'apply',
      ...base,
      approvedPlanSha256: digest('--approved-plan-sha256'),
      previewHash: digest('--preview-hash'),
    };
  }
  if (b.has('--status')) {
    only(['--actor-user', '--operation-key', '--action', '--manifest-sha256', '--payload-sha256']);
    const action = need('--action');
    if (action !== 'correct' && action !== 'compensate')
      throw new CliAdmissionError('invalid_arguments');
    return {
      mode: 'status',
      ...base,
      actorUser: uuid('--actor-user'),
      operationKey: uuid('--operation-key'),
      action,
      manifestSha256: digest('--manifest-sha256'),
      payloadSha256: digest('--payload-sha256'),
    };
  }
  only([]);
  return { mode: b.has('--draft') ? 'draft' : 'preview', ...base };
}

export async function run(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  try {
    const args = parseMappingArgs(argv);
    const raw = readPrivateJson(args.manifestPath);
    const outputPath = admitOutputPath(args.outputPath);
    // Strict decoding happens before the application graph loads.
    const manifest = args.mode === 'draft' ? null : decodeMappingManifestV1(raw);
    const draft =
      args.mode === 'draft'
        ? (raw as import('./lib/faces-garment-mapping').MappingManifestV1 & Record<string, never>)
        : null;
    const target =
      manifest?.target ??
      (draft as unknown as { target: import('./lib/operator-principal').QualifiedOperatorTarget })
        .target;
    const actor =
      args.mode === 'status'
        ? args.actorUser!
        : (manifest?.actorProfileId ??
          (draft as unknown as { actorProfileId: string }).actorProfileId);
    if (manifest && manifest.orgId !== args.org) throw new CliAdmissionError('org_mismatch');
    const command =
      args.mode === 'apply' && manifest
        ? decodeMappingCommand({
            manifest,
            approvedPlanSha256: args.approvedPlanSha256,
            previewHash: args.previewHash,
          })
        : null;
    const status =
      args.mode === 'status' && manifest
        ? decodeMappingStatusInput({
            target: manifest.target,
            orgId: args.org,
            actorProfileId: args.actorUser,
            operationKey: args.operationKey,
            action: args.action,
            manifestSha256: args.manifestSha256,
            expectedPayloadHash: args.payloadSha256,
            manifest,
          })
        : null;
    // The principal is the verified subject; status uses the CURRENT reader (--actor-user), the others the manifest actor.
    const session = await openOperatorSession({
      env,
      target,
      actorProfileId: actor,
      orgId: args.org,
    });
    try {
      const svc = await session.loader.load('garmentMapping');
      let result: unknown;
      let code = 0;
      if (args.mode === 'draft') {
        result = await svc.draftMappingManifest(session.ctx, raw as never);
      } else if (args.mode === 'preview') {
        const p = await svc.previewMappingCorrection(session.ctx, manifest!);
        result = p;
        code = p.outcome === 'preview' ? 0 : 4;
      } else if (args.mode === 'apply') {
        const r = await svc.applyMappingCorrection(session.ctx, command!, session.actor);
        result = r;
      } else {
        const st = await svc.getMappingCorrectionStatus(session.ctx, status!);
        result = st;
        code = st.outcome === 'applied' ? 0 : st.outcome === 'absent_before_unchanged' ? 4 : 5;
      }
      writePrivateOutput(outputPath, `${canonicalJson(result)}\n`);
      console.log(JSON.stringify({ mode: args.mode, exit: code, output: outputPath }));
      return code;
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === 'MappingError') {
        const c = (error as { code: string }).code;
        console.error(`refused: ${c}`);
        return c === 'forbidden' ? 2 : c === 'incomplete' ? 3 : 4;
      }
      throw error;
    } finally {
      await session.close();
    }
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (
      error instanceof CliAdmissionError ||
      error instanceof SessionRefusal ||
      error instanceof ReconciliationError ||
      name === 'OperatorPrincipalError' ||
      name === 'OperatorAuthorityError'
    ) {
      console.error(`refused: ${(error as { code?: string }).code ?? (error as Error).message}`);
      return 2;
    }
    // Transport or commit uncertainty after a possible write: unknown until same-key status, never rollback.
    console.error(
      'result unknown: read the same operation key with --status before any new action',
    );
    return 5;
  }
}

if (import.meta.main) process.exit(await run(process.argv.slice(2), process.env));
