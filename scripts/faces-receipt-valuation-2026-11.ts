/**
 * FACES receipt valuation diagnostic (minion-meta spec 123, S1/S2). READ-ONLY: no apply flag, no writer call.
 *
 *   bun --no-env-file scripts/faces-receipt-valuation-2026-11.ts --org <uuid> --entry <uuid> --line <uuid> \
 *     --evidence-manifest <private-json> --output <private-json>
 *
 * Private env only: FACES_RECEIPT_DATABASE_URL, FACES_OPERATOR_ACCESS_TOKEN, FACES_OPERATOR_ANON_KEY,
 * FACES_OPERATOR_AUTH_URL (the only URL the token is sent to; the manifest's target.authUrl must equal it).
 * Exit 0 complete (document absent/unverified still useful) | 2 admission | 3 incomplete/output | 4 integrity/unsupported.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import {
  buildDiagnosticResult,
  decodeDiagnosticReport,
  diagnosticManifestSha256,
  diagnosticReportSha256,
  MAX_MANIFEST_BYTES,
  parseDiagnosticManifestJson,
  ticketFinancialSha256,
  type Consumer,
  type Coverage,
  type DiagnosticEvidenceManifestV1,
  type DiagnosticReport,
  type EntryHeader,
  type EntryLine,
  type Movement,
  type ScalarEvidence,
  type SourceEvidence,
  type StockReplayMath,
} from './lib/faces-receipt-replay';
import {
  operatorDatabaseIdentity,
  verifyOperatorPrincipal,
  type VerifiedOperatorPrincipal,
} from './lib/operator-principal';

const MAX_REPORT_BYTES = 20971520;
const CONTEXT_CAP = 10000;
const AFFECTED_CAP = 129;
const CONSUMER_CAP = 128;
const DISPOSABLE_MARKER = 'minion-360-disposable:v1';
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Fixed credential-free refusal. exit 2 = admission, 3 = incomplete read/output. */
export class CliError extends Error {
  constructor(
    readonly exit: 2 | 3,
    readonly code: string,
  ) {
    super(code);
    this.name = 'CliError';
  }
}

export type Args = { org: string; entry: string; line: string; manifest: string; output: string };

/** Every flag required and unique; unknown/duplicate/positional input is refused before any business read. */
export function parseArgs(argv: readonly string[]): Args {
  const names: Record<string, keyof Args> = {
    '--org': 'org',
    '--entry': 'entry',
    '--line': 'line',
    '--evidence-manifest': 'manifest',
    '--output': 'output',
  };
  const got: Partial<Args> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = names[argv[i]];
    const value = argv[i + 1];
    if (!key || value === undefined || value.startsWith('--') || key in got)
      throw new CliError(2, 'invalid_arguments');
    got[key] = value;
  }
  if (Object.keys(names).length !== Object.keys(got).length)
    throw new CliError(2, 'invalid_arguments');
  const a = got as Args;
  for (const k of ['org', 'entry', 'line'] as const)
    if (!UUID_RX.test(a[k])) throw new CliError(2, 'invalid_arguments');
  return a;
}

/** Owner-private regular file, never a symlink, bounded size. */
export function readPrivateFile(path: string): string {
  let st;
  try {
    st = lstatSync(path);
  } catch {
    throw new CliError(2, 'invalid_manifest');
  }
  if (
    !st.isFile() ||
    (st.mode & 0o077) !== 0 ||
    st.uid !== process.getuid?.() ||
    st.size > MAX_MANIFEST_BYTES
  ) {
    throw new CliError(2, 'invalid_manifest');
  }
  return readFileSync(path, 'utf8');
}

/** Owned temp file (0600) then atomic no-clobber publish; temp always cleaned. */
export function writePrivateFile(path: string, text: string): void {
  if (Buffer.byteLength(text) > MAX_REPORT_BYTES) throw new CliError(3, 'output_failed');
  const tmp = join(dirname(path), `.${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(tmp, 'wx', 0o600);
    writeSync(fd, text);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    linkSync(tmp, path); // fails if the approved output already exists: never clobber
  } catch {
    throw new CliError(3, 'output_failed');
  } finally {
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(tmp);
    } catch {
      /* already gone */
    }
  }
}

// ───────────────────────── source reader (T007): one repeatable-read read-only snapshot ─────────────────────────
type Sql = postgres.Sql | postgres.TransactionSql;
type Row = Record<string, unknown>;
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const ISO = (col: string) => `to_char(${col} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const META = ['purchaseId', 'providerRef', 'currency', 'fxRate', 'fxUpdatedAt'] as const;
const metaCols = META.map(
  (
    k,
  ) => `case when not e.metadata ? '${k}' then 'missing' when jsonb_typeof(e.metadata->'${k}')='null' then 'null'
    when jsonb_typeof(e.metadata->'${k}') in ('string','number') then 'value' else 'bad' end as m_${k},
    e.metadata->>'${k}' as v_${k}`,
).join(',');

function scalar(row: Row, k: (typeof META)[number]): ScalarEvidence {
  const state = row[`m_${k}`];
  if (state === 'bad') throw new CliError(3, 'schema_mismatch');
  return {
    state: state as ScalarEvidence['state'],
    value: state === 'value' ? String(row[`v_${k}`]) : null,
  };
}

async function loadHeaders(
  tx: Sql,
  org: string,
  ids: string[],
): Promise<Map<string, { header: EntryHeader; source: Movement['source'] }>> {
  const out = new Map<string, { header: EntryHeader; source: Movement['source'] }>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await tx.unsafe(
      `select e.id::text id, e.human_id, e.type, e.status, ${ISO('e.posted_at')} posted_at, to_jsonb(e)::text row_text,
              e.metadata->>'source' src, e.metadata->>'sourceId' src_id, ${metaCols}
         from public.stk_entries e where e.org_id=$1 and e.id = any($2::uuid[])`,
      [org, ids.slice(i, i + 500)],
    );
    for (const r of rows) {
      const type = String(r.type);
      const srcKind =
        type === 'receipt'
          ? 'receipt'
          : r.src === 'pos'
            ? 'pos_ticket'
            : r.src === 'booking'
              ? 'booking'
              : r.src === 'invoice'
                ? 'invoice'
                : 'unknown';
      const srcId =
        srcKind === 'receipt'
          ? String(r.id)
          : r.src_id && UUID_RX.test(String(r.src_id))
            ? String(r.src_id)
            : null;
      out.set(String(r.id), {
        header: {
          id: String(r.id),
          humanId: (r.human_id as string | null) ?? null,
          type,
          status: String(r.status),
          postedAt: (r.posted_at as string | null) ?? null,
          rowSha256: sha(String(r.row_text)),
          purchaseId: scalar(r, 'purchaseId'),
          providerRef: scalar(r, 'providerRef'),
          currency: scalar(r, 'currency'),
          fxRate: scalar(r, 'fxRate'),
          fxUpdatedAt: scalar(r, 'fxUpdatedAt'),
        },
        source: { kind: srcKind, id: srcKind === 'unknown' ? null : srcId },
      });
    }
  }
  return out;
}

async function loadLines(tx: Sql, org: string, ids: string[]): Promise<Map<string, EntryLine[]>> {
  const out = new Map<string, EntryLine[]>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await tx.unsafe(
      `select l.id::text id, l.entry_id::text entry_id, l.item_id::text item_id, l.qty::text qty, l.uom, l.rate::text rate,
              l.from_warehouse_id::text from_wh, l.to_warehouse_id::text to_wh, l.line_no, to_jsonb(l)::text row_text
         from public.stk_entry_lines l where l.org_id=$1 and l.entry_id = any($2::uuid[]) order by l.line_no, l.id`,
      [org, ids.slice(i, i + 500)],
    );
    for (const r of rows) {
      const line: EntryLine = {
        id: String(r.id),
        entryId: String(r.entry_id),
        itemId: String(r.item_id),
        qty: String(r.qty),
        uom: (r.uom as string | null) ?? null,
        rate: r.rate === null ? null : String(r.rate),
        fromWarehouseId: (r.from_wh as string | null) ?? null,
        toWarehouseId: (r.to_wh as string | null) ?? null,
        lineNo: Number(r.line_no),
        rowSha256: sha(String(r.row_text)),
      };
      out.set(line.entryId, [...(out.get(line.entryId) ?? []), line]);
    }
  }
  return out;
}

async function toMovements(tx: Sql, org: string, ledger: Row[]): Promise<Movement[]> {
  const ids = [...new Set(ledger.map((r) => String(r.entry_id)))];
  const headers = await loadHeaders(tx, org, ids);
  const lines = await loadLines(tx, org, ids);
  return ledger.map((r) => {
    const h = headers.get(String(r.entry_id));
    if (!h) throw new CliError(3, 'source_unavailable');
    return {
      id: String(r.id),
      entryId: String(r.entry_id),
      itemId: String(r.item_id),
      warehouseId: String(r.warehouse_id),
      postedAt: String(r.posted_at),
      qtyDelta: String(r.qty_delta),
      valueDelta: String(r.value_delta),
      qtyAfter: String(r.qty_after),
      valuationRate: String(r.valuation_rate),
      rowSha256: sha(String(r.row_text)),
      header: h.header,
      lines: lines.get(String(r.entry_id)) ?? [],
      source: h.source,
      reversalOfLedgerId: null,
    };
  });
}

const LEDGER_COLS = `l.id::text id, l.entry_id::text entry_id, l.item_id::text item_id, l.warehouse_id::text warehouse_id,
  ${ISO('l.posted_at')} posted_at, l.qty_delta::text qty_delta, l.value_delta::text value_delta, l.qty_after::text qty_after,
  l.valuation_rate::text valuation_rate, to_jsonb(l)::text row_text`;

/** Reads ONE receipt/line chain inside an already-open READ ONLY REPEATABLE READ transaction. Probes limit+1 everywhere. */
export async function readReceiptSource(
  tx: Sql,
  ids: { orgId: string; receiptEntryId: string; receiptLineId: string },
): Promise<{ source: SourceEvidence; coverage: Coverage }> {
  const { orgId, receiptEntryId, receiptLineId } = ids;
  const empty: SourceEvidence = {
    receipt: null,
    line: null,
    item: null,
    warehouse: null,
    bin: null,
    opening: {
      state: 'unknown',
      priorLedgerId: null,
      priorRowSha256: null,
      qty: null,
      rate: null,
      valueEngine: null,
    },
    context: [],
    affected: [],
    boundary: null,
    consumers: [],
  };
  const cov: Coverage = {
    readsComplete: true,
    contextComplete: true,
    affectedComplete: true,
    consumersComplete: true,
    baselineComplete: false,
    hypotheticalComplete: false,
    contextCount: null,
    affectedCount: null,
    consumerCount: null,
    contextReadCount: 0,
    affectedReadCount: 0,
    consumerReadCount: 0,
    lastReadLedgerId: null,
    latestSameKeyLedgerId: null,
    maxObservedLedgerId: null,
  };
  const head = (await loadHeaders(tx, orgId, [receiptEntryId])).get(receiptEntryId);
  const lines = (await loadLines(tx, orgId, [receiptEntryId])).get(receiptEntryId) ?? [];
  const line = lines.find((l) => l.id === receiptLineId) ?? null;
  if (!head || !line) return { source: empty, coverage: { ...cov, readsComplete: false } };
  const source: SourceEvidence = { ...empty, receipt: head.header, line };
  const [item] = await tx.unsafe(
    `select i.id::text id, i.uom, i.consumption_uom, i.units_per_stock_uom::text upsu, to_jsonb(i)::text row_text
       from public.stk_items i where i.org_id=$1 and i.id=$2`,
    [orgId, line.itemId],
  );
  if (item) {
    source.item = {
      id: String(item.id),
      rowSha256: sha(String(item.row_text)),
      stockUom: String(item.uom),
      consumptionUom: (item.consumption_uom as string | null) ?? null,
      unitsPerStockUom: item.upsu === null ? null : String(item.upsu),
    };
  }
  const own = await tx.unsafe(
    `select ${LEDGER_COLS} from public.stk_ledger l where l.org_id=$1 and l.entry_id=$2 order by l.id limit 2`,
    [orgId, receiptEntryId],
  );
  if (own.length !== 1) return { source, coverage: { ...cov, readsComplete: false } };
  const rid = String(own[0].id);
  const wh = String(own[0].warehouse_id);
  const key = [orgId, line.itemId, wh] as const;
  const [w] = await tx.unsafe(
    `select w.id::text id, to_jsonb(w)::text row_text from public.stk_warehouses w where w.org_id=$1 and w.id=$2`,
    [orgId, wh],
  );
  if (w) source.warehouse = { id: String(w.id), rowSha256: sha(String(w.row_text)) };
  const [bin] = await tx.unsafe(
    `select b.qty::text qty, b.valuation_rate::text rate, to_jsonb(b)::text row_text from public.stk_bins b where b.org_id=$1 and b.item_id=$2 and b.warehouse_id=$3`,
    [...key],
  );
  if (bin)
    source.bin = {
      rowSha256: sha(String(bin.row_text)),
      qty: String(bin.qty),
      rate: String(bin.rate),
    };
  const [{ latest, maxall }] = await tx.unsafe(
    `select (select max(id)::text from public.stk_ledger where org_id=$1 and item_id=$2 and warehouse_id=$3) latest,
            (select max(id)::text from public.stk_ledger where org_id=$1) maxall`,
    [...key],
  );
  cov.latestSameKeyLedgerId = (latest as string | null) ?? null;
  cov.maxObservedLedgerId = (maxall as string | null) ?? null;
  // context: complete same-key prefix strictly before the receipt (probe cap+1)
  const ctxRows = await tx.unsafe(
    `select ${LEDGER_COLS} from public.stk_ledger l where l.org_id=$1 and l.item_id=$2 and l.warehouse_id=$3 and l.id < $4::bigint order by l.id desc limit ${CONTEXT_CAP + 1}`,
    [...key, rid],
  );
  cov.contextComplete = ctxRows.length <= CONTEXT_CAP;
  const ctxAsc = ctxRows.slice(0, CONTEXT_CAP).reverse();
  source.context = cov.contextComplete ? await toMovements(tx, orgId, ctxAsc) : [];
  cov.contextReadCount = source.context.length;
  if (cov.contextComplete) cov.contextCount = source.context.length;
  const prior = ctxAsc[ctxAsc.length - 1];
  source.opening = !cov.contextComplete
    ? source.opening
    : prior
      ? {
          state: 'verified',
          priorLedgerId: String(prior.id),
          priorRowSha256: sha(String(prior.row_text)),
          qty: String(prior.qty_after),
          rate: String(prior.valuation_rate),
          valueEngine: String(Number(prior.qty_after) * Number(prior.valuation_rate)),
        }
      : {
          state: 'empty_verified',
          priorLedgerId: null,
          priorRowSha256: null,
          qty: '0',
          rate: '0',
          valueEngine: '0',
        };
  // affected: receipt through latest, probe one past the 129-entry envelope
  const aff = await tx.unsafe(
    `select ${LEDGER_COLS} from public.stk_ledger l where l.org_id=$1 and l.item_id=$2 and l.warehouse_id=$3 and l.id >= $4::bigint order by l.id limit ${AFFECTED_CAP + 1}`,
    [...key, rid],
  );
  const admitted = await toMovements(tx, orgId, aff.slice(0, AFFECTED_CAP));
  source.affected = admitted;
  cov.affectedReadCount = admitted.length;
  if (aff.length > AFFECTED_CAP) {
    source.boundary = (await toMovements(tx, orgId, [aff[AFFECTED_CAP]]))[0];
    cov.affectedComplete = false;
  } else cov.affectedCount = admitted.length;
  cov.lastReadLedgerId = admitted.length ? admitted[admitted.length - 1].id : null;
  // consumers of the admitted issue entries
  const issueIds = admitted.slice(1).map((m) => m.entryId);
  const consumers: Consumer[] = [];
  if (issueIds.length) {
    const tickets = await tx.unsafe(
      `select t.id::text id, t.stock_entry_id::text entry_id, to_jsonb(t)::text row_text,
              coalesce((select jsonb_agg(to_jsonb(p)::text order by p.id) from public.pos_payments p where p.org_id=t.org_id and p.ticket_id=t.id),'[]'::jsonb) pays
         from public.pos_tickets t where t.org_id=$1 and t.stock_entry_id = any($2::uuid[]) order by t.id limit ${CONSUMER_CAP + 1}`,
      [orgId, issueIds],
    );
    // TODO(handoff): F3's complete financial/fiscal family (invoice binding, shift, emission) is not exported by F3 yet;
    // this digest binds the ticket row and its payments only. Widen it when F3 publishes the shared digest.
    for (const t of tickets.slice(0, CONSUMER_CAP)) {
      consumers.push({
        kind: 'pos_ticket',
        id: String(t.id),
        rowSha256: sha(String(t.row_text)),
        entryId: String(t.entry_id),
        financialFiscalSha256: ticketFinancialSha256(String(t.row_text), t.pays as string[]),
      });
    }
    const accruals = await tx.unsafe(
      `select a.id::text id, a.realized_entry_id::text entry_id, a.source, a.source_id::text source_id, a.item_id::text item_id,
              a.realized_qty::text rq, a.realized_value::text rv, ${ISO('a.realized_at')} realized_at, a.status, to_jsonb(a)::text row_text
         from public.stk_accruals a where a.org_id=$1 and a.realized_entry_id = any($2::uuid[]) order by a.id limit ${CONSUMER_CAP + 1}`,
      [orgId, issueIds],
    );
    for (const a of accruals.slice(0, CONSUMER_CAP)) {
      consumers.push({
        kind: 'stock_accrual',
        id: String(a.id),
        rowSha256: sha(String(a.row_text)),
        entryId: String(a.entry_id),
        sourceType: String(a.source),
        sourceId: String(a.source_id),
        itemId: String(a.item_id),
        realizedQty: (a.rq as string | null) ?? null,
        realizedValue: (a.rv as string | null) ?? null,
        realizedAt: (a.realized_at as string | null) ?? null,
        status: String(a.status),
      });
    }
    if (tickets.length > CONSUMER_CAP || accruals.length > CONSUMER_CAP)
      cov.consumersComplete = false;
  }
  consumers.sort((x, y) => (x.kind + x.id).localeCompare(y.kind + y.id));
  source.consumers = consumers;
  cov.consumerReadCount = consumers.length;
  if (cov.consumersComplete) cov.consumerCount = consumers.length;
  return { source, coverage: cov };
}

// ───────────────────────── composition ─────────────────────────
export type SnapshotResult = { source: SourceEvidence; coverage: Coverage; snapshotId: string };

export type CliDeps = {
  env: Readonly<Record<string, string | undefined>>;
  readFile(path: string): string;
  writeFile(path: string, text: string): void;
  verifyPrincipal: typeof verifyOperatorPrincipal;
  /** One bounded read-only snapshot: owned connection, target/role/GUC checks, fresh authority, source read. */
  readSnapshot(input: {
    databaseUrl: string;
    manifest: DiagnosticEvidenceManifestV1;
    principal: VerifiedOperatorPrincipal;
  }): Promise<SnapshotResult>;
  /** Loaded only after argument, target and principal admission. */
  loadMath(
    principal: VerifiedOperatorPrincipal,
    target: DiagnosticEvidenceManifestV1['target'],
  ): Promise<StockReplayMath>;
  now(): Date;
};

/** Returns the process exit code; never throws and never prints credentials or SQL. */
export async function runDiagnose(argv: readonly string[], deps: CliDeps): Promise<number> {
  try {
    const args = parseArgs(argv);
    let manifest: DiagnosticEvidenceManifestV1;
    try {
      manifest = parseDiagnosticManifestJson(deps.readFile(args.manifest));
    } catch (e) {
      throw e instanceof CliError ? e : new CliError(2, 'invalid_manifest');
    }
    if (
      manifest.orgId !== args.org ||
      manifest.receiptEntryId !== args.entry ||
      manifest.receiptLineId !== args.line
    ) {
      throw new CliError(2, 'target_mismatch');
    }
    const url = deps.env.FACES_RECEIPT_DATABASE_URL;
    const token = deps.env.FACES_OPERATOR_ACCESS_TOKEN;
    const anon = deps.env.FACES_OPERATOR_ANON_KEY;
    if (!url || !token || !anon) throw new CliError(2, 'actor_unavailable');
    let identity: string;
    try {
      identity = operatorDatabaseIdentity(url, manifest.target.authProject);
    } catch {
      throw new CliError(2, 'target_mismatch');
    }
    if (identity !== manifest.target.databaseIdentity) throw new CliError(2, 'target_mismatch');
    let principal: VerifiedOperatorPrincipal;
    try {
      principal = await deps.verifyPrincipal({
        accessToken: token,
        authUrl: manifest.target.authUrl,
        trustedAuthUrl: deps.env.FACES_OPERATOR_AUTH_URL,
        anonKey: anon,
        expectedProfileId: manifest.actorProfileId,
        targetFingerprint: manifest.target,
      });
    } catch {
      throw new CliError(2, 'actor_unavailable');
    }
    // Every current attestor must equal the executing owner and cannot post-date the snapshot.
    if (
      manifest.document.state === 'owner_attested' &&
      manifest.document.verifiedByProfileId !== principal.profileId
    ) {
      throw new CliError(2, 'actor_unavailable');
    }
    // Everything below may touch business data.
    const math = await deps.loadMath(principal, manifest.target);
    const snap = await deps.readSnapshot({ databaseUrl: url, manifest, principal });
    const result = buildDiagnosticResult(
      manifest,
      snap.source,
      snap.coverage,
      'hypothetical_replay',
      math,
    );
    const manifestSha = diagnosticManifestSha256(manifest);
    const report: DiagnosticReport = {
      metadata: {
        runId: randomUUID(),
        observedAt: deps.now().toISOString(),
        snapshotId: snap.snapshotId,
        outputReference: null,
      },
      diagnosticManifestSha256: manifestSha,
      reportSha256: diagnosticReportSha256(manifestSha, result),
      result,
    };
    const text = JSON.stringify(decodeDiagnosticReport(JSON.parse(JSON.stringify(report))));
    deps.writeFile(args.output, `${text}\n`);
    return result.outcome === 'complete' ? 0 : result.outcome === 'incomplete' ? 3 : 4;
  } catch (e) {
    if (e instanceof CliError) return e.exit;
    return 3; // unclassified failure after admission: incomplete, never a guessed result
  }
}

// ───────────────────────── real wiring (only reached from the package command) ─────────────────────────
type Admit = (
  tx: postgres.TransactionSql,
  manifest: DiagnosticEvidenceManifestV1,
  principal: VerifiedOperatorPrincipal,
) => Promise<void>;

function realReadSnapshot(admit: Admit): CliDeps['readSnapshot'] {
  return async ({ databaseUrl, manifest, principal }) => {
    const host = new URL(databaseUrl).hostname.toLowerCase();
    const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host);
    const client = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      onnotice: () => undefined,
      ssl: loopback ? false : { rejectUnauthorized: true },
      connection: { statement_timeout: 12000, lock_timeout: 1000 },
    });
    const deadline = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new CliError(3, 'timeout')), 60000).unref(),
    );
    const work = (async () => {
      try {
        return await client.begin('isolation level repeatable read read only', async (tx) => {
          await tx.unsafe(`set local timezone = 'UTC'`);
          const [db] = await tx.unsafe(
            `select current_database() db, shobj_description((select oid from pg_database where datname=current_database()),'pg_database') marker`,
          );
          if (
            new URL(databaseUrl).pathname.slice(1) !== db.db ||
            (loopback && db.marker !== DISPOSABLE_MARKER)
          ) {
            throw new CliError(2, 'target_mismatch');
          }
          await tx.unsafe(
            `select set_config('role','app_ledger',true), set_config('app.current_org_id',$1,true), set_config('app.current_profile_id',$2,true)`,
            [manifest.orgId, principal.profileId],
          );
          const [ro] = await tx.unsafe(
            `select current_setting('transaction_read_only') ro, current_setting('app.current_org_id') org`,
          );
          if (ro.ro !== 'on' || ro.org !== manifest.orgId) throw new CliError(2, 'target_mismatch');
          await admit(tx, manifest, principal); // same snapshot, before any business read
          const out = await readReceiptSource(tx, {
            orgId: manifest.orgId,
            receiptEntryId: manifest.receiptEntryId,
            receiptLineId: manifest.receiptLineId,
          });
          return { ...out, snapshotId: sha(`${manifest.orgId}:${Date.now()}`) };
        });
      } finally {
        await client.end({ timeout: 5 }).catch(() => undefined);
      }
    })();
    return Promise.race([work, deadline]);
  };
}

// TODO(handoff): the wiring below (GoTrue principal, closed loader rbac/stockLogic keys, drizzle over the owned transaction) has not been run
// end to end; F7's operator-bootstrap smoke is not on this branch. Unit tests inject every port.
if (import.meta.main) {
  void (async () => {
    let loader:
      { load: (k: 'rbac' | 'stockLogic') => Promise<never>; close(): Promise<void> } | undefined;
    const deps: CliDeps = {
      env: process.env,
      readFile: readPrivateFile,
      writeFile: writePrivateFile,
      verifyPrincipal: verifyOperatorPrincipal,
      // Business graph loads only here, after argument/target/principal admission (closed Vite SSR loader, empty env).
      loadMath: async (principal, target) => {
        const { createOperatorServiceLoader } = await import('./lib/operator-service-loader');
        loader = (await createOperatorServiceLoader({
          principal,
          target,
        })) as unknown as typeof loader;
        const s = (await loader!.load('stockLogic')) as unknown as StockReplayMath;
        return {
          computeLegValue: s.computeLegValue,
          applyLedgerDelta: s.applyLedgerDelta,
          round4: s.round4,
        };
      },
      readSnapshot: realReadSnapshot(async (tx, manifest, principal) => {
        const rbac = (await loader!.load('rbac')) as unknown as {
          resolveFreshCapabilitiesReadOnlyInTransaction(
            tx: unknown,
            org: string,
            profile: string,
          ): Promise<{
            membershipRole: string | null;
            capabilities: { can(m: string, a: string): boolean; fieldLevel(m: string): number };
          }>;
        };
        const { drizzle } = await import('drizzle-orm/postgres-js');
        const caps = await rbac.resolveFreshCapabilitiesReadOnlyInTransaction(
          drizzle(tx as never),
          manifest.orgId,
          principal.profileId,
        );
        const c = caps.capabilities;
        // Real owner membership (not a custom role key) plus stock manage, POS view and sensitive finance cost access.
        if (
          caps.membershipRole !== 'owner' ||
          !c.can('stock', 'manage') ||
          !c.can('pos', 'view') ||
          !c.can('finance', 'view') ||
          c.fieldLevel('finance') < 1
        ) {
          throw new CliError(2, 'actor_unavailable');
        }
      }),
      now: () => new Date(),
    };
    try {
      process.exitCode = await runDiagnose(process.argv.slice(2), deps);
    } finally {
      await loader?.close().catch(() => undefined);
    }
  })();
}
