import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import { finProducts } from '$server/db/pg-finance-schema';
import {
  posPackageGrants,
  posPackageRedemptions,
  type PosPackageGrant,
  type PosPackageRedemption,
} from '$server/db/pg-pos-schema';
// Deliberate circular import — see the note in pos-accounts.service.ts.
import { PosError, type Actor } from './pos.service';
import { getFinSettings } from './finance.service';
import { clientMatch, type ClientRef } from './pos-accounts.service';
import {
  allocateGrants,
  grantStatus,
  grantToday,
  sessionsRemaining as remainingOf,
  type GrantStatus,
  type PackageEdge,
} from './pos-accounts.logic';

/**
 * Session packages: one payment, N sessions.
 *
 * Selling a bundle sellable mints one GRANT per `fin_product_components` edge;
 * booking a session mints a REDEMPTION row against that grant; cancelling the
 * booking reverses the redemption and the session comes back.
 *
 * THE rule of this file: sessions used is `count(*) where reversed_at is null`,
 * derived on every read. There is no counter column, so a crashed booking, a
 * retried request or a partial series rollback cannot leave a grant claiming
 * sessions nobody took.
 *
 * Spec: specs/2026-09-13-pos-scheduling-packages-payment-plans-spec.md §2.3,
 * §3.1, §3.2. Slice S1 — data layer only; `submitTicket` explosion (S2) and
 * booking-time redemption (S3) call in here later.
 */

export type { PackageEdge } from './pos-accounts.logic';

/** A grant plus everything derived from its redemption rows. */
export interface GrantView {
  grant: PosPackageGrant;
  sessionsUsed: number;
  sessionsRemaining: number;
  /** Derived, not `grant.status` — see pos-accounts.logic.ts `grantStatus`. */
  status: GrantStatus;
  /** `fin_products.name` of the bundle sellable. Null when the catalog row is
   *  gone — a grant outlives the product it was sold as. */
  packageName: string | null;
}

/** The package ticket line a grant set is minted from. */
export interface PackageLineSource {
  ticketId: string;
  lineId: string;
  /** The bundle sellable (fin_products.id). */
  packageProductId: string;
  qty: number;
  /** The line's money AFTER discount — what the client actually paid. */
  total: number;
}

export interface CreateGrantsInput {
  line: PackageLineSource;
  /** `fin_product_components` edges of the package. Empty = not a package. */
  edges: PackageEdge[];
  client: ClientRef;
  /** 'YYYY-MM-DD' or null for no expiry — build it with `expiryFrom`. */
  expiresAt?: string | null;
}

export interface RedeemInput {
  grantId: string;
  bookingId?: string | null;
  ticketId?: string | null;
  ticketLineId?: string | null;
  actor?: Actor;
}

/** Today in the org's business timezone — the expiry boundary's calendar. */
async function orgToday(ctx: CoreCtx): Promise<string> {
  const { timezone } = await getFinSettings(ctx);
  return grantToday(timezone);
}

/** Non-reversed redemptions per grant. The single source of "sessions used". */
async function usedByGrantInTx(
  tx: CoreTx,
  orgId: string,
  grantIds: string[],
): Promise<Map<string, number>> {
  if (!grantIds.length) return new Map();
  const rows = await tx
    .select({ grantId: posPackageRedemptions.grantId, used: count() })
    .from(posPackageRedemptions)
    .where(
      and(
        eq(posPackageRedemptions.orgId, orgId),
        inArray(posPackageRedemptions.grantId, grantIds),
        isNull(posPackageRedemptions.reversedAt),
      ),
    )
    .groupBy(posPackageRedemptions.grantId);
  return new Map(rows.map((r) => [r.grantId, Number(r.used)]));
}

/** Catalog names of the bundle sellables these grants were sold as. */
async function packageNamesInTx(
  tx: CoreTx,
  orgId: string,
  productIds: string[],
): Promise<Map<string, string | null>> {
  const ids = [...new Set(productIds)];
  if (!ids.length) return new Map();
  const rows = await tx
    .select({ id: finProducts.id, name: finProducts.name })
    .from(finProducts)
    .where(and(eq(finProducts.orgId, orgId), inArray(finProducts.id, ids)));
  return new Map(rows.map((r) => [r.id, r.name ?? null]));
}

function viewOf(
  grant: PosPackageGrant,
  used: number,
  today: string,
  names: Map<string, string | null>,
): GrantView {
  return {
    grant,
    sessionsUsed: used,
    sessionsRemaining: remainingOf(grant.sessionsTotal, used),
    status: grantStatus(
      {
        sessionsTotal: grant.sessionsTotal,
        used,
        expiresAt: grant.expiresAt,
        status: grant.status,
      },
      today,
    ),
    packageName: names.get(grant.packageProductId) ?? null,
  };
}

// ---- selling ----

/**
 * Mint the grants a package ticket line buys — called from INSIDE
 * `submitTicket`'s money transaction (S2), so grants commit with the sale or
 * not at all.
 *
 * Returns `[]` for a line with no bundle edges, so the caller can invoke it
 * unconditionally for every line instead of branching first.
 */
export async function createGrantsForTicketLine(
  tx: CoreTx,
  orgId: string,
  input: CreateGrantsInput,
): Promise<PosPackageGrant[]> {
  const allocations = allocateGrants(input.line.total, input.line.qty, input.edges);
  if (!allocations.length) return [];
  if (!input.client.partyId && !input.client.crmContactId)
    throw new PosError('a package sale needs an identified client', 'client_required');
  return tx
    .insert(posPackageGrants)
    .values(
      allocations.map((a) => ({
        orgId,
        partyId: input.client.partyId ?? null,
        crmContactId: input.client.crmContactId ?? null,
        sourceTicketId: input.line.ticketId,
        sourceLineId: input.line.lineId,
        packageProductId: input.line.packageProductId,
        serviceProductId: a.childProductId,
        sessionsTotal: a.sessionsTotal,
        unitValue: String(a.unitValue),
        expiresAt: input.expiresAt ?? null,
        status: 'active',
      })),
    )
    .returning();
}

// ---- reading ----

export async function listGrants(
  ctx: CoreCtx,
  client: ClientRef,
  opts: { serviceProductId?: string; limit?: number } = {},
): Promise<GrantView[]> {
  const today = await orgToday(ctx);
  return withOrgCore(ctx, async (tx) => {
    const conds = [eq(posPackageGrants.orgId, ctx.tenantId), clientMatch(client, posPackageGrants)];
    if (opts.serviceProductId)
      conds.push(eq(posPackageGrants.serviceProductId, opts.serviceProductId));
    const grants = await tx
      .select()
      .from(posPackageGrants)
      .where(and(...conds))
      .orderBy(desc(posPackageGrants.createdAt))
      .limit(opts.limit ?? 100);
    const used = await usedByGrantInTx(
      tx,
      ctx.tenantId,
      grants.map((g) => g.id),
    );
    const names = await packageNamesInTx(
      tx,
      ctx.tenantId,
      grants.map((g) => g.packageProductId),
    );
    return grants.map((g) => viewOf(g, used.get(g.id) ?? 0, today, names));
  });
}

export async function getGrant(ctx: CoreCtx, id: string): Promise<GrantView | null> {
  const today = await orgToday(ctx);
  return withOrgCore(ctx, async (tx) => {
    const grant = await loadGrantInTx(tx, ctx.tenantId, id, false);
    if (!grant) return null;
    const used = await usedByGrantInTx(tx, ctx.tenantId, [id]);
    const names = await packageNamesInTx(tx, ctx.tenantId, [grant.packageProductId]);
    return viewOf(grant, used.get(id) ?? 0, today, names);
  });
}

/** Sessions left on one grant. Derived, never read from a counter column. */
export async function sessionsRemaining(ctx: CoreCtx, grantId: string): Promise<number> {
  const view = await getGrant(ctx, grantId);
  if (!view) throw new PosError('grant not found', 'not_found');
  return view.sessionsRemaining;
}

async function loadGrantInTx(
  tx: CoreTx,
  orgId: string,
  id: string,
  lock: boolean,
): Promise<PosPackageGrant | undefined> {
  const q = tx
    .select()
    .from(posPackageGrants)
    .where(and(eq(posPackageGrants.id, id), eq(posPackageGrants.orgId, orgId)))
    .limit(1);
  const [row] = await (lock ? q.for('update') : q);
  return row;
}

// ---- redeeming ----

/**
 * Draw one session, inside a caller's transaction — the form the booking
 * service needs (S3), where a whole series must redeem atomically or not at
 * all.
 *
 * `select … for update` on the grant row is what makes the capacity check
 * real: two clerks booking the last session of the same package serialise on
 * that lock, so the second one sees the first one's redemption and gets
 * `package_exhausted` instead of overselling.
 */
export async function redeemSessionInTx(
  tx: CoreTx,
  orgId: string,
  input: RedeemInput,
  today: string,
): Promise<PosPackageRedemption> {
  const grant = await loadGrantInTx(tx, orgId, input.grantId, true);
  if (!grant) throw new PosError('grant not found', 'not_found');
  const used = (await usedByGrantInTx(tx, orgId, [grant.id])).get(grant.id) ?? 0;
  const status = grantStatus(
    { sessionsTotal: grant.sessionsTotal, used, expiresAt: grant.expiresAt, status: grant.status },
    today,
  );
  if (status === 'cancelled') throw new PosError('package is cancelled', 'package_cancelled');
  if (status === 'exhausted')
    throw new PosError('package has no sessions left', 'package_exhausted');
  if (status === 'expired') throw new PosError('package has expired', 'package_expired');
  const [row] = await tx
    .insert(posPackageRedemptions)
    .values({
      orgId,
      grantId: grant.id,
      bookingId: input.bookingId ?? null,
      ticketId: input.ticketId ?? null,
      ticketLineId: input.ticketLineId ?? null,
      redeemedBy: input.actor?.id ?? null,
    })
    .returning();
  return row;
}

export async function redeemSession(
  ctx: CoreCtx,
  input: RedeemInput,
): Promise<PosPackageRedemption> {
  const today = await orgToday(ctx);
  return withOrgCore(ctx, (tx) => redeemSessionInTx(tx, ctx.tenantId, input, today));
}

/**
 * Hand a session back. Idempotent on purpose: cancelling an already-cancelled
 * booking, or a no-show that is then cancelled, must not throw — it returns the
 * redemption exactly as it already stands.
 */
export async function reverseRedemptionInTx(
  tx: CoreTx,
  orgId: string,
  id: string,
  opts: { reason?: string | null; actor?: Actor } = {},
): Promise<PosPackageRedemption> {
  const [existing] = await tx
    .select()
    .from(posPackageRedemptions)
    .where(and(eq(posPackageRedemptions.id, id), eq(posPackageRedemptions.orgId, orgId)))
    .limit(1);
  if (!existing) throw new PosError('redemption not found', 'not_found');
  if (existing.reversedAt) return existing;
  const [row] = await tx
    .update(posPackageRedemptions)
    .set({
      reversedAt: new Date(),
      reversedBy: opts.actor?.id ?? null,
      reversalReason: opts.reason ?? null,
    })
    .where(
      and(
        eq(posPackageRedemptions.id, id),
        eq(posPackageRedemptions.orgId, orgId),
        isNull(posPackageRedemptions.reversedAt),
      ),
    )
    .returning();
  return row ?? existing;
}

export function reverseRedemption(
  ctx: CoreCtx,
  id: string,
  opts: { reason?: string | null; actor?: Actor } = {},
): Promise<PosPackageRedemption> {
  return withOrgCore(ctx, (tx) => reverseRedemptionInTx(tx, ctx.tenantId, id, opts));
}

/** Live (non-reversed) redemptions of a booking — what a cancel must reverse. */
export function listRedemptions(
  ctx: CoreCtx,
  filter: { grantId?: string; bookingId?: string; ticketId?: string; liveOnly?: boolean },
): Promise<PosPackageRedemption[]> {
  return withOrgCore(ctx, (tx) => {
    const conds = [eq(posPackageRedemptions.orgId, ctx.tenantId)];
    if (filter.grantId) conds.push(eq(posPackageRedemptions.grantId, filter.grantId));
    if (filter.bookingId) conds.push(eq(posPackageRedemptions.bookingId, filter.bookingId));
    if (filter.ticketId) conds.push(eq(posPackageRedemptions.ticketId, filter.ticketId));
    if (filter.liveOnly) conds.push(isNull(posPackageRedemptions.reversedAt));
    return tx
      .select()
      .from(posPackageRedemptions)
      .where(and(...conds))
      .orderBy(desc(posPackageRedemptions.redeemedAt));
  });
}

/**
 * Cancel a grant. Refuses while any session is still live (409
 * `package_in_use`, spec §3.6) — the sessions have to be handed back first, by
 * cancelling their bookings, so the client never silently loses a paid session.
 *
 * TODO(handoff): §4.2's "cancel a grant" action on /pos/accounts will hit this
 * rule for a PARTIALLY used package (client paid for 6, took 2, never returns).
 * Whether an admin cancel may keep the 2 consumed sessions and void the rest —
 * and whether the unused value returns as pos_client_ledger credit — is an
 * unanswered policy question, not an implementation gap. See meta
 * proposals/2026-09-13-pos-packages-plans-s1-followups.md.
 */
export async function cancelGrant(
  ctx: CoreCtx,
  id: string,
  actor?: Actor,
): Promise<PosPackageGrant> {
  return withOrgCore(ctx, async (tx) => {
    const grant = await loadGrantInTx(tx, ctx.tenantId, id, true);
    if (!grant) throw new PosError('grant not found', 'not_found');
    if (grant.status === 'cancelled') return grant;
    const used = (await usedByGrantInTx(tx, ctx.tenantId, [id])).get(id) ?? 0;
    if (used > 0) throw new PosError(`package has ${used} redeemed session(s)`, 'package_in_use');
    const [row] = await tx
      .update(posPackageGrants)
      .set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: actor?.id ?? null })
      .where(and(eq(posPackageGrants.id, id), eq(posPackageGrants.orgId, ctx.tenantId)))
      .returning();
    return row;
  });
}
