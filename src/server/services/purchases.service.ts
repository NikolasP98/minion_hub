/**
 * Purchases module — SUNAT RCE one-way backfill + minion-local CRUD.
 * Spec: specs/2026-08-14-purchases-rce-module-spec.md
 *
 * SUNAT→minion sync only calls RCE READ endpoints (periods, resumen CSV) —
 * never the write endpoints (aceptar/reemplazar propuesta, registrar
 * preliminar, importar/eliminar comprobantes — manual §5.2-5.29). That push
 * leg is deliberately deferred; `sync_state` is its hook.
 *
 * Row-level detail: SUNAT's only row-level RCE read is a broken async file
 * export (see sunat-sire-client.ts `descargarArchivoReporte` doc comment for
 * the verified-live quirk). Until SUNAT fixes it, sync uses the per-doc-type
 * resumen CSV as the row source — one fin_purchases row per doc type per
 * period (aggregate), not per physical document. Period totals + status
 * still backfill correctly; per-document detail is a follow-up once the
 * download works.
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  finPurchases,
  finPurchasePeriods,
  type FinPurchase,
  type FinPurchasePeriod,
} from '$server/db/pg-finance-schema';
import { SunatSireClient } from '$server/finance/connectors/sunat-sire-client';
import { resolvePeriods } from '$server/finance/connectors/sunat-sire-connector';
import { getSource } from './finance.service';
import { decryptCreds } from './finance-secrets';

export class PurchasesError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'PurchasesError';
  }
}

// ── resumen CSV parsing (pure — see sunat-sire-client.resumenComprobantes) ──

export interface ResumenRow {
  docTypeCode: string;
  docTypeLabel: string;
  count: number;
  baseGravada: number;
  igv: number;
  total: number;
}

export interface ResumenParseResult {
  rows: ResumenRow[]; // excludes the TOTAL line
  totals: ResumenRow;
}

const EMPTY_TOTALS: ResumenRow = {
  docTypeCode: 'TOTAL',
  docTypeLabel: 'Total',
  count: 0,
  baseGravada: 0,
  igv: 0,
  total: 0,
};

/** Parses SUNAT's pipe-delimited resumencomprobantes CSV. Columns (verified
 *  live 2026-08-14): Tipo|Documentos|BI Gravado DG|IGV DG|…|Total CP (last). */
export function parseResumenCsv(text: string): ResumenParseResult {
  const lines = text
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.length > 0);
  if (lines.length < 2) return { rows: [], totals: { ...EMPTY_TOTALS } };

  const rows: ResumenRow[] = [];
  let totals: ResumenRow = { ...EMPTY_TOTALS };
  for (const line of lines.slice(1)) {
    const cols = line.split('|');
    if (cols.length < 4) continue;
    const label = cols[0].trim();
    const count = Number(cols[1]) || 0;
    const baseGravada = Number(cols[2]) || 0;
    const igv = Number(cols[3]) || 0;
    const total = Number(cols[cols.length - 1]) || 0;
    if (/^total\b/i.test(label)) {
      totals = { docTypeCode: 'TOTAL', docTypeLabel: 'Total', count, baseGravada, igv, total };
      continue;
    }
    const m = /^(\d+)-(.*)$/.exec(label);
    rows.push({
      docTypeCode: m ? m[1] : label,
      docTypeLabel: (m ? m[2] : label).trim(),
      count,
      baseGravada,
      igv,
      total,
    });
  }
  return { rows, totals };
}

/** 'No Presentado' → open, 'Presentado' → closed (same convention as the
 *  sunat-sire connector's resolvePeriods). */
export function periodStatusFromDesEstado(desEstado: string): 'open' | 'closed' {
  return /^no/i.test(desEstado) ? 'open' : 'closed';
}

// ── reads ──

export async function listPeriods(ctx: CoreCtx): Promise<FinPurchasePeriod[]> {
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(finPurchasePeriods)
      .where(eq(finPurchasePeriods.orgId, ctx.tenantId))
      .orderBy(desc(finPurchasePeriods.period)),
  );
}

export async function listPurchases(
  ctx: CoreCtx,
  opts: { period?: string } = {},
): Promise<FinPurchase[]> {
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(finPurchases)
      .where(
        opts.period
          ? and(eq(finPurchases.orgId, ctx.tenantId), eq(finPurchases.period, opts.period))
          : eq(finPurchases.orgId, ctx.tenantId),
      )
      .orderBy(desc(finPurchases.period), asc(finPurchases.docType)),
  );
}

async function getPeriodRow(ctx: CoreCtx, tx: CoreTx, period: string) {
  const [row] = await tx
    .select()
    .from(finPurchasePeriods)
    .where(and(eq(finPurchasePeriods.orgId, ctx.tenantId), eq(finPurchasePeriods.period, period)))
    .limit(1);
  return row ?? null;
}

// ── CRUD (locking enforced here, not the UI) ──

export interface ManualPurchaseInput {
  period: string;
  supplierRuc?: string | null;
  supplierName?: string | null;
  docType?: string | null;
  serie?: string | null;
  numero?: string | null;
  issuedAt?: string | null; // YYYY-MM-DD
  currency?: string | null;
  baseGravada?: number | null;
  igv?: number | null;
  total?: number | null;
}

export async function createPurchase(
  ctx: CoreCtx,
  input: ManualPurchaseInput,
): Promise<FinPurchase> {
  if (!/^\d{6}$/.test(input.period))
    throw new PurchasesError('period must be YYYYMM', 'invalid_input');
  return withOrgCore(ctx, async (tx) => {
    const period = await getPeriodRow(ctx, tx, input.period);
    if (period && period.status === 'closed')
      throw new PurchasesError('period is closed', 'period_closed');
    const [row] = await tx
      .insert(finPurchases)
      .values({
        orgId: ctx.tenantId,
        source: 'manual',
        providerRef: null,
        period: input.period,
        supplierRuc: input.supplierRuc ?? null,
        supplierName: input.supplierName ?? null,
        docType: input.docType ?? null,
        serie: input.serie ?? null,
        numero: input.numero ?? null,
        issuedAt: input.issuedAt ?? null,
        currency: input.currency ?? 'PEN',
        baseGravada: input.baseGravada != null ? String(input.baseGravada) : null,
        igv: input.igv != null ? String(input.igv) : null,
        total: input.total != null ? String(input.total) : null,
        periodStatus: period?.status ?? 'open',
        syncState: 'local',
      })
      .returning();
    return row;
  });
}

export type PurchasePatch = Partial<Omit<ManualPurchaseInput, 'period'>>;

export async function updatePurchase(
  ctx: CoreCtx,
  id: string,
  patch: PurchasePatch,
): Promise<FinPurchase> {
  return withOrgCore(ctx, async (tx) => {
    const [existing] = await tx
      .select()
      .from(finPurchases)
      .where(and(eq(finPurchases.id, id), eq(finPurchases.orgId, ctx.tenantId)))
      .limit(1);
    if (!existing) throw error(404, 'purchase not found');
    const period = await getPeriodRow(ctx, tx, existing.period);
    if (period && period.status === 'closed')
      throw new PurchasesError('period is closed', 'period_closed');

    const [row] = await tx
      .update(finPurchases)
      .set({
        supplierRuc: patch.supplierRuc !== undefined ? patch.supplierRuc : existing.supplierRuc,
        supplierName: patch.supplierName !== undefined ? patch.supplierName : existing.supplierName,
        docType: patch.docType !== undefined ? patch.docType : existing.docType,
        serie: patch.serie !== undefined ? patch.serie : existing.serie,
        numero: patch.numero !== undefined ? patch.numero : existing.numero,
        issuedAt: patch.issuedAt !== undefined ? patch.issuedAt : existing.issuedAt,
        currency: patch.currency !== undefined ? patch.currency : existing.currency,
        baseGravada:
          patch.baseGravada !== undefined
            ? patch.baseGravada != null
              ? String(patch.baseGravada)
              : null
            : existing.baseGravada,
        igv:
          patch.igv !== undefined ? (patch.igv != null ? String(patch.igv) : null) : existing.igv,
        total:
          patch.total !== undefined
            ? patch.total != null
              ? String(patch.total)
              : null
            : existing.total,
        // Editing a synced (SUNAT-sourced) row means it no longer mirrors
        // SUNAT verbatim — flag it so the next sync skips it instead of
        // silently clobbering the user's edit.
        syncState: existing.syncState === 'synced' ? 'diverged' : existing.syncState,
        updatedAt: new Date(),
      })
      .where(eq(finPurchases.id, id))
      .returning();
    return row;
  });
}

export async function deletePurchase(ctx: CoreCtx, id: string): Promise<void> {
  await withOrgCore(ctx, async (tx) => {
    const [existing] = await tx
      .select()
      .from(finPurchases)
      .where(and(eq(finPurchases.id, id), eq(finPurchases.orgId, ctx.tenantId)))
      .limit(1);
    if (!existing) throw error(404, 'purchase not found');
    const period = await getPeriodRow(ctx, tx, existing.period);
    if (period && period.status === 'closed')
      throw new PurchasesError('period is closed', 'period_closed');
    await tx.delete(finPurchases).where(eq(finPurchases.id, id));
  });
}

// ── sync (READ-only SUNAT calls; see module doc comment) ──

/** Gentle pacing between period fetches — "space SUNAT calls ~1-3s apart"
 *  per the live-test guidance in the spec; SUNAT's gateway rate-limits. */
const PERIOD_DELAY_MS = 1_500;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface SyncResult {
  periodsSynced: number;
  purchasesUpserted: number;
  divergedSkipped: string[]; // provider_refs left alone because they were user-edited
}

export async function syncPurchases(ctx: CoreCtx): Promise<SyncResult> {
  const source = await getSource(ctx, 'sunat-sire');
  if (!source || !source.enabled)
    throw new PurchasesError('sunat-sire source not configured', 'no_source');
  const refs = (source.secretRefs ?? {}) as Record<string, unknown>;
  if (!refs.ciphertext || !refs.iv)
    throw new PurchasesError('sunat-sire has no credentials configured', 'no_credentials');
  const creds = decryptCreds(String(refs.ciphertext), String(refs.iv));
  const config = (source.config ?? {}) as Record<string, unknown>;
  const ruc = String(config.ruc ?? '');
  const clientId = String(config.clientId ?? '');
  if (!/^\d{11}$/.test(ruc) || !clientId)
    throw new PurchasesError('sunat-sire config missing ruc/clientId', 'invalid_source');

  const client = new SunatSireClient({
    ruc,
    clientId,
    username: creds.username,
    password: creds.password,
    clientSecret: creds.clientSecret ?? '',
  });

  const allPeriods = await client.periodosRce();
  const periods = resolvePeriods(allPeriods, {
    startPeriod: typeof config.startPeriod === 'string' ? config.startPeriod : undefined,
  });
  const statusByPeriod = new Map(
    allPeriods.map((p) => [p.perTributario, periodStatusFromDesEstado(p.desEstado)]),
  );

  let purchasesUpserted = 0;
  const divergedSkipped: string[] = [];

  for (let i = 0; i < periods.length; i++) {
    const period = periods[i];
    const status = statusByPeriod.get(period) ?? 'open';
    if (i > 0) await sleep(PERIOD_DELAY_MS);
    const csv = await client.resumenComprobantes(period, '1', '0');
    const { rows, totals } = parseResumenCsv(csv);

    await withOrgCore(ctx, async (tx) => {
      await tx
        .insert(finPurchasePeriods)
        .values({
          orgId: ctx.tenantId,
          period,
          status,
          docCount: totals.count,
          baseGravada: String(totals.baseGravada),
          igv: String(totals.igv),
          total: String(totals.total),
          lastSyncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [finPurchasePeriods.orgId, finPurchasePeriods.period],
          set: {
            status,
            docCount: totals.count,
            baseGravada: String(totals.baseGravada),
            igv: String(totals.igv),
            total: String(totals.total),
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          },
        });

      for (const row of rows) {
        const providerRef = `${period}:${row.docTypeCode}`;
        const [existing] = await tx
          .select()
          .from(finPurchases)
          .where(
            and(eq(finPurchases.orgId, ctx.tenantId), eq(finPurchases.providerRef, providerRef)),
          )
          .limit(1);
        if (existing?.syncState === 'diverged') {
          // Never overwrite a user-edited row — flag it in the result instead.
          divergedSkipped.push(providerRef);
          // Still keep its denormalised period_status current so locking stays honest.
          if (existing.periodStatus !== status) {
            await tx
              .update(finPurchases)
              .set({ periodStatus: status, updatedAt: new Date() })
              .where(eq(finPurchases.id, existing.id));
          }
          continue;
        }
        await tx
          .insert(finPurchases)
          .values({
            orgId: ctx.tenantId,
            source: 'sunat',
            providerRef,
            period,
            docType: row.docTypeCode,
            currency: 'PEN',
            baseGravada: String(row.baseGravada),
            igv: String(row.igv),
            total: String(row.total),
            periodStatus: status,
            syncState: 'synced',
            metadata: { docTypeLabel: row.docTypeLabel, count: row.count, csvLine: row },
          })
          .onConflictDoUpdate({
            target: [finPurchases.orgId, finPurchases.providerRef],
            set: {
              docType: row.docTypeCode,
              baseGravada: String(row.baseGravada),
              igv: String(row.igv),
              total: String(row.total),
              periodStatus: status,
              syncState: 'synced',
              metadata: { docTypeLabel: row.docTypeLabel, count: row.count, csvLine: row },
              updatedAt: new Date(),
            },
          });
        purchasesUpserted++;
      }

      // A period that flips to closed locks every row in it, sunat AND manual.
      await tx
        .update(finPurchases)
        .set({ periodStatus: status, updatedAt: new Date() })
        .where(and(eq(finPurchases.orgId, ctx.tenantId), eq(finPurchases.period, period)));
    });
  }

  return { periodsSynced: periods.length, purchasesUpserted, divergedSkipped };
}
