#!/usr/bin/env bun
/**
 * Single-ticket historical garment stock-only repost wrapper (minion-meta spec 122, contracts/repair.md). Dry-run by default.
 *   preview : --org <uuid> --manifest <path> --output <path>
 *   apply   : preview flags + --apply --approved-plan-sha256 <digest> --preview-hash <digest>
 *   status  : --status --org --manifest --operation-key <uuid> --manifest-sha256 <digest> --output
 *   draft   : --draft --org --manifest <draft-input.json> --output   (read-only manifest producer)
 * Private env as faces:stock:mapping. Exit: 0 eligible/applied/replayed/applied status; 2 invalid args, auth or target;
 * 3 incomplete; 4 blocked, stale, key conflict or absent status; 5 transport/commit uncertainty.
 */
import {
  canonicalJson,
  UUID_RE,
  DIGEST_RE,
  ReconciliationError,
} from './lib/faces-stock-reconciliation';
import { decodeGarmentRepostManifestV1, garmentManifestSha256 } from './lib/faces-garment-repost';
import {
  CliAdmissionError,
  admitOutputPath,
  readPrivateJson,
  writePrivateOutput,
} from './faces-stock-reconcile-2026-11';
import { openOperatorSession, SessionRefusal } from './lib/faces-operator-session';

export interface RepostArgs {
  mode: 'preview' | 'apply' | 'status' | 'draft';
  org: string;
  manifestPath: string;
  outputPath: string;
  approvedPlanSha256?: string;
  previewHash?: string;
  operationKey?: string;
  manifestSha256?: string;
}
const VALUE = [
  '--org',
  '--manifest',
  '--output',
  '--approved-plan-sha256',
  '--preview-hash',
  '--operation-key',
  '--manifest-sha256',
];
const BOOL = ['--apply', '--status', '--draft'];
export function parseRepostArgs(argv: readonly string[]): RepostArgs {
  const v = new Map<string, string>();
  const b = new Set<string>();
  const bad = (): never => {
    throw new CliAdmissionError('invalid_arguments');
  };
  for (let i = 0; i < argv.length; i += 1) {
    const f = argv[i];
    if (BOOL.includes(f)) b.has(f) ? bad() : b.add(f);
    else if (VALUE.includes(f)) {
      const x = argv[i + 1];
      if (x === undefined || x.startsWith('--') || v.has(f)) bad();
      v.set(f, x);
      i += 1;
    } else bad();
  }
  if (b.size > 1) bad();
  const need = (f: string) => v.get(f) ?? bad();
  const org = need('--org');
  if (!UUID_RE.test(org)) bad();
  const only = (extra: string[]) =>
    [...v.keys()].forEach((k) =>
      ['--org', '--manifest', '--output', ...extra].includes(k) ? null : bad(),
    );
  const digest = (f: string) => (DIGEST_RE.test(need(f)) ? need(f) : bad());
  const base = { org, manifestPath: need('--manifest'), outputPath: need('--output') };
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
    only(['--operation-key', '--manifest-sha256']);
    return {
      mode: 'status',
      ...base,
      operationKey: UUID_RE.test(need('--operation-key')) ? need('--operation-key') : bad(),
      manifestSha256: digest('--manifest-sha256'),
    };
  }
  only([]);
  return { mode: b.has('--draft') ? 'draft' : 'preview', ...base };
}

export async function run(argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number> {
  try {
    const args = parseRepostArgs(argv);
    const raw = readPrivateJson(args.manifestPath);
    const outputPath = admitOutputPath(args.outputPath);
    const manifest = args.mode === 'draft' ? null : decodeGarmentRepostManifestV1(raw);
    if (manifest && manifest.orgId !== args.org) throw new CliAdmissionError('org_mismatch');
    if (
      manifest &&
      args.mode === 'apply' &&
      args.approvedPlanSha256 !== garmentManifestSha256(manifest)
    )
      throw new CliAdmissionError('approved_plan_mismatch');
    if (manifest && args.mode === 'status' && args.operationKey !== manifest.operationKey)
      throw new CliAdmissionError('status_input_conflict');
    const draft = raw as {
      target: import('./lib/operator-principal').QualifiedOperatorTarget;
      actorProfileId: string;
    };
    const session = await openOperatorSession({
      env,
      target: manifest?.target ?? draft.target,
      actorProfileId: manifest?.actorProfileId ?? draft.actorProfileId,
      orgId: args.org,
    });
    try {
      const svc = await session.loader.load('garmentRepost');
      let result: unknown;
      let code = 0;
      if (args.mode === 'draft')
        result = await svc.draftGarmentRepostManifest(session.ctx, raw as never);
      else if (args.mode === 'preview') {
        const p = await svc.previewGarmentRepost(session.ctx, manifest!);
        result = p;
        code = p.outcome === 'preview' ? 0 : 4;
      } else if (args.mode === 'apply') {
        result = await svc.applyGarmentRepost(
          session.ctx,
          {
            manifest: manifest!,
            approvedPlanSha256: args.approvedPlanSha256!,
            previewHash: args.previewHash!,
          },
          session.actor,
        );
      } else {
        const st = await svc.getGarmentRepostStatus(session.ctx, {
          operationKey: args.operationKey!,
          manifestSha256: args.manifestSha256!,
        });
        result = st;
        code = st.outcome === 'applied' ? 0 : 4;
      }
      writePrivateOutput(outputPath, `${canonicalJson(result)}\n`);
      console.log(JSON.stringify({ mode: args.mode, exit: code, output: outputPath }));
      return code;
    } catch (error) {
      if ((error as { name?: string })?.name === 'RepostError') {
        const c = (error as { code: string }).code;
        console.error(`refused: ${c}`);
        return c === 'forbidden' ? 2 : 4;
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
    console.error(
      'result unknown: read the same operation key with --status before any new action',
    );
    return 5;
  }
}
if (import.meta.main) process.exit(await run(process.argv.slice(2), process.env));
