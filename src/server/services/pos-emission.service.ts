import { and, asc, eq, sql } from 'drizzle-orm';
import { waitUntil } from '@vercel/functions';
import { env } from '$env/dynamic/private';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import {
  posEmissions,
  posSeries,
  posTicketLines,
  type PosEmission,
  type PosSeries,
  type PosTicket,
} from '$server/db/pg-pos-schema';
import { parties } from '$server/db/pg-party-schema';
import { emitToBeta } from '$server/finance/emission';
import type { EmissionDocType, EmissionInvoice } from '$server/finance/emission';
import { PosError, type PosSettings } from './pos.service';
import { getFinSettings } from './finance.service';
import { resolveIgvRate } from '$server/finance/tax';
// The ticket->EmissionInvoice mapping is a PURE module (no $env/db/@vercel
// imports) so scripts/shadow-emit-test.ts can import it under plain `bun run`
// without a SvelteKit runtime. Re-exported here for existing callers/tests.
import {
  resolveEmissionDocType,
  ticketToEmission,
  type PartyDocInfo,
  type EmitterConfig,
  type TicketEmissionLine,
  type TicketEmissionTotals,
} from './pos-emission-mapping';
export {
  resolveEmissionDocType,
  ticketToEmission,
  type PartyDocInfo,
  type EmitterConfig,
  type TicketEmissionLine,
  type TicketEmissionTotals,
} from './pos-emission-mapping';

/**
 * Serie/correlativo allocator + ticket->SUNAT-beta wiring (shadow emission).
 * Spec: specs/2026-08-14-pos-shadow-emission-spec.md.
 */

// ---- allocator ----

/**
 * Atomically hand out the next document number for (org, docType,
 * environment): a SINGLE `UPDATE … RETURNING`, never a read-then-write —
 * that's the whole concurrency guarantee (same shape as naming-series.ts
 * nextSerialId, but consuming an EXISTING active row instead of upserting a
 * counter, since a serie also carries its own doc_type/environment/active
 * identity). MUST run inside the caller's transaction so a failed
 * pos_emissions insert rolls the number back.
 */
export async function allocateNumber(
  tx: CoreTx,
  orgId: string,
  docType: EmissionDocType,
  environment: 'beta' | 'prod',
): Promise<{ serie: string; correlativo: number }> {
  const rows = (await tx.execute(sql`
    update pos_series set next_number = next_number + 1, updated_at = now()
    where org_id = ${orgId} and doc_type = ${docType} and environment = ${environment} and active
    returning serie, next_number - 1 as correlativo
  `)) as unknown as Array<{ serie: string; correlativo: number | string }>;
  const row = rows[0];
  if (!row) throw new PosError('no active serie', 'no_serie');
  return { serie: row.serie, correlativo: Number(row.correlativo) };
}

/**
 * Auto-seed the shadow series (B999/03, F999/01, environment 'beta') for an
 * org if absent. Idempotent (ON CONFLICT on the org_id+doc_type+serie unique
 * index) — safe to call every time shadow mode is enabled. Called from
 * pos.service.ts `updatePosSettings`, inside the SAME transaction as the
 * settings upsert.
 */
export async function seedShadowSeries(tx: CoreTx, orgId: string): Promise<void> {
  await tx.execute(sql`
    insert into pos_series (org_id, doc_type, serie, next_number, environment, active)
    values
      (${orgId}, '03', 'B999', 1, 'beta', true),
      (${orgId}, '01', 'F999', 1, 'beta', true)
    on conflict (org_id, doc_type, serie) do nothing
  `);
}

export async function listPosSeries(ctx: CoreCtx): Promise<PosSeries[]> {
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(posSeries)
      .where(eq(posSeries.orgId, ctx.tenantId))
      .orderBy(asc(posSeries.docType), asc(posSeries.serie)),
  );
}

// ---- emitter config ----

/**
 * Emitter identity for shadow emission. Spec says "read from fin_settings if
 * present, else env" — `fin_settings` (pg-finance-schema.ts) has no
 * ruc/razonSocial columns today and adding one is out of scope for this
 * additive-migration-only slice ("keep it simple, one org in practice"), so
 * this reads env only. Revisit if a second org ever needs its own emitter.
 */
export function resolveEmitter(): EmitterConfig {
  const ruc = env.POS_EMISSION_EMITTER_RUC;
  const razonSocial = env.POS_EMISSION_EMITTER_NAME;
  if (!ruc || !razonSocial) {
    throw new PosError(
      'POS_EMISSION_EMITTER_RUC/POS_EMISSION_EMITTER_NAME not configured',
      'no_emitter',
    );
  }
  return {
    ruc,
    razonSocial,
    ubigeo: env.POS_EMISSION_EMITTER_UBIGEO || undefined,
    address: env.POS_EMISSION_EMITTER_ADDRESS || undefined,
  };
}

// ---- wiring: submitTicket -> shadow emission ----

/** Per-process last-call gate (spec §4): the beta gateway 401s back-to-back
 *  requests, ~3s spacing is enough. Module-scope on purpose — one gate per
 *  serverless isolate, shared across every shadow emission it fires. */
const BETA_CALL_SPACING_MS = 3000;
let lastBetaCallAt = 0;

async function betaRateLimit(): Promise<void> {
  const wait = lastBetaCallAt + BETA_CALL_SPACING_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastBetaCallAt = Date.now();
}

function loadBetaCert(): { certPem: string; keyPem: string } | null {
  const certPem = env.POS_EMISSION_BETA_CERT;
  const keyPem = env.POS_EMISSION_BETA_KEY;
  if (!certPem || !keyPem) return null;
  return { certPem, keyPem };
}

/**
 * The actual beta call (spec §4 step 2): build -> sign -> send -> parse ->
 * update the `pos_emissions` row. Never throws — this always runs detached
 * (waitUntil / fire-and-forget), so a caller has nothing to catch; a failure
 * degrades the row to `status='error'` instead, which the ticket-detail
 * endpoint surfaces (spec §4 step 3 — rows stuck 'pending' are the loss
 * measure for a frozen/crashed runtime).
 */
async function runBetaEmission(
  ctx: CoreCtx,
  emissionId: string,
  invoice: EmissionInvoice,
  docRequired: boolean,
): Promise<void> {
  try {
    const cert = loadBetaCert();
    if (!cert)
      throw new PosError('POS_EMISSION_BETA_CERT/POS_EMISSION_BETA_KEY not configured', 'no_cert');
    await betaRateLimit();
    const result = await emitToBeta(invoice, cert.certPem, cert.keyPem);
    const accepted = result.responseCode === '0';
    const description = docRequired ? `[DOC-REQUIRED] ${result.description}` : result.description;
    await withOrgCore(ctx, (tx) =>
      tx
        .update(posEmissions)
        .set({
          status: accepted ? 'accepted' : 'rejected',
          responseCode: result.responseCode,
          responseDescription: description,
          xmlHash: result.xmlHash,
          updatedAt: new Date(),
        })
        .where(and(eq(posEmissions.id, emissionId), eq(posEmissions.orgId, ctx.tenantId))),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[pos-emission] beta emission failed', emissionId, message);
    await withOrgCore(ctx, (tx) =>
      tx
        .update(posEmissions)
        .set({ status: 'error', responseDescription: message.slice(0, 500), updatedAt: new Date() })
        .where(and(eq(posEmissions.id, emissionId), eq(posEmissions.orgId, ctx.tenantId))),
    ).catch((updateErr) =>
      console.error('[pos-emission] failed to record error status', emissionId, updateErr),
    );
  }
}

/** waitUntil on Vercel; a detached (but error-guarded) promise everywhere
 *  else — `waitUntil` itself never throws for a real Promise (it no-ops
 *  outside a request context), so this is mostly belt-and-suspenders. */
function fireAndForget(promise: Promise<void>): void {
  const guarded = promise.catch((e) => console.error('[pos-emission] unhandled', e));
  waitUntil(guarded);
}

/**
 * Shadow-emission wiring point, called from `submitTicket` only when
 * `settings.emission.mode === 'shadow'` (spec §4). Synchronous half:
 * allocate a number + insert the pending `pos_emissions` row in ONE small
 * transaction (checkout latency gains only ~one insert). Async half: the
 * real beta call fires post-response via `fireAndForget`. Never throws —
 * a shadow-emission hiccup must never fail a real sale.
 */
export async function triggerShadowEmission(
  ctx: CoreCtx,
  ticket: PosTicket,
  settings: PosSettings,
): Promise<void> {
  try {
    const [lines, partyRows, finSettings] = await Promise.all([
      withOrgCore(ctx, (tx) =>
        tx
          .select({
            description: posTicketLines.description,
            qty: posTicketLines.qty,
            total: posTicketLines.total,
          })
          .from(posTicketLines)
          .where(
            and(eq(posTicketLines.orgId, ctx.tenantId), eq(posTicketLines.ticketId, ticket.id)),
          ),
      ),
      ticket.partyId
        ? withOrgCore(ctx, (tx) =>
            tx
              .select({
                docType: parties.docType,
                docNumber: parties.docNumber,
                name: parties.name,
              })
              .from(parties)
              .where(and(eq(parties.id, ticket.partyId as string), eq(parties.orgId, ctx.tenantId)))
              .limit(1),
          )
        : Promise.resolve([]),
      getFinSettings(ctx),
    ]);
    const customer: PartyDocInfo | null = partyRows[0] ?? null;
    const emitter = resolveEmitter();
    const docType = resolveEmissionDocType(customer, settings.emission.docTypeDefault);
    // Resolved OUTSIDE the document transaction on purpose: a throw inside it
    // rolls back the whole thing, so the refusal could not leave the audit row
    // `recordUnemittableTicket` writes (⚠️ A2 of the igv-rate spec) — the row
    // would be erased by the same rollback that gave the correlativo back.
    let igvRate: number;
    try {
      igvRate = resolveIgvRate(finSettings);
    } catch (e) {
      await recordUnemittableTicket(ctx, ticket, docType, e);
      return;
    }

    const {
      id: emissionId,
      invoice,
      docRequired,
    } = await withOrgCore(ctx, async (tx) => {
      const allocation = await allocateNumber(tx, ctx.tenantId, docType, 'beta');
      const mapped = ticketToEmission(
        ticket,
        lines,
        customer,
        settings,
        allocation,
        emitter,
        igvRate,
      );
      const [row] = await tx
        .insert(posEmissions)
        .values({
          orgId: ctx.tenantId,
          ticketId: ticket.id,
          docType,
          serie: allocation.serie,
          correlativo: allocation.correlativo,
          environment: 'beta',
          status: 'pending',
          total: ticket.total,
          clientDocType: mapped.invoice.client.docType,
          clientDocNumber: mapped.invoice.client.docNumber,
        })
        .returning();
      return { id: row.id, invoice: mapped.invoice, docRequired: mapped.docRequired };
    });
    fireAndForget(runBetaEmission(ctx, emissionId, invoice, docRequired));
  } catch (e) {
    // no_serie / no_emitter / a transient DB error — log and move on, this must
    // never surface to the cashier (spec §4: shadow is invisible). Verified for
    // ⚠️ A2 of the igv-rate spec: a misconfigured rate cannot reach the
    // cashier's response, submitTicket only awaits this never-throwing
    // function. no_serie and no_emitter stay log-only here — unchanged
    // pre-existing behaviour, and no_serie in particular cannot be recorded as
    // a row at all, since pos_emissions.serie/correlativo are NOT NULL and a
    // serie is exactly what is missing.
    console.error('[pos-emission] shadow emission trigger failed', ticket.id, e);
  }
}

/**
 * Record a ticket the shadow emitter REFUSED to build a document for — today
 * only `invalid_tax_rate` (spec ⚠️ A2 of
 * 2026-08-17-hub-igv-rate-from-org-config-spec.md: an org whose configured
 * `fin_settings.tax_rate` is unusable for SUNAT gets a hard error instead of a
 * silently wrong document).
 *
 * A2 states that such a failure "surfaces as a `pos_emissions` row with
 * `status='error'`" — this is what makes that true. The refusal happens BEFORE
 * the normal insert, so without a row of its own it would exist only in the
 * server log: `listEmissionsForTicket` (the ticket-detail read, see
 * `pos.service.ts` getTicket) would show nothing and a misconfigured org would
 * silently stop shadow-emitting. It costs the correlativo the document would
 * have used — exactly like every failure one step later (bad cert, SUNAT
 * unreachable), which already degrades an allocated row to `status='error'`.
 *
 * The client columns stay null on purpose: the ticket->invoice mapping never
 * ran, so there is no resolved SUNAT client document to record.
 */
async function recordUnemittableTicket(
  ctx: CoreCtx,
  ticket: PosTicket,
  docType: EmissionDocType,
  cause: unknown,
): Promise<void> {
  const message = cause instanceof Error ? cause.message : String(cause);
  console.error('[pos-emission] shadow emission refused', ticket.id, message);
  await withOrgCore(ctx, async (tx) => {
    const allocation = await allocateNumber(tx, ctx.tenantId, docType, 'beta');
    await tx.insert(posEmissions).values({
      orgId: ctx.tenantId,
      ticketId: ticket.id,
      docType,
      serie: allocation.serie,
      correlativo: allocation.correlativo,
      environment: 'beta',
      status: 'error',
      responseDescription: message.slice(0, 500),
      total: ticket.total,
    });
  });
}

export async function listEmissionsForTicket(
  ctx: CoreCtx,
  ticketId: string,
): Promise<PosEmission[]> {
  return withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(posEmissions)
      .where(and(eq(posEmissions.orgId, ctx.tenantId), eq(posEmissions.ticketId, ticketId))),
  );
}
