import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { posPaymentPlans, posPlanOperationCancellations } from '$server/db/pg-pos-schema';
import type { PlanInput } from '../pos-accounts.service';
import { minorToDecimal } from '$lib/money/decimal';
import { PosError } from './errors';
import { moneyMinor, requirePosCurrency } from './money';
import type { DueInstalment } from './payment-plan-schedule';
import { canonicalWalletClientKey } from './wallet-identity';

const uuid = z.string().uuid();
export function planOperationId(value: unknown): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new PosError('Invalid operation identity.', 'invalid_operation');
  return parsed.data.toLowerCase();
}
function operationActor(ctx: CoreCtx): string {
  const parsed = uuid.safeParse(ctx.profileId);
  if (!parsed.success)
    throw new PosError('Authenticated profile required.', 'operation_actor_required');
  return parsed.data.toLowerCase();
}
const normalizedId = (value: string | null | undefined) =>
  value == null ? null : planOperationId(value);

/** Hash request intent, including omitted currency, never mutable settings or plan state. */
export function planRequestHash(
  input: PlanInput,
  normalized: {
    total: number;
    dueSchedule: DueInstalment[] | null;
  },
): string {
  const intent = {
    version: 1,
    partyId: normalizedId(input.client.partyId),
    crmContactId: normalizedId(input.client.crmContactId),
    productId: normalizedId(input.productId),
    bookingId: normalizedId(input.bookingId),
    title: input.title.trim(),
    total: minorToDecimal(moneyMinor(normalized.total, { numeric12: true })),
    currency:
      input.currency === undefined
        ? { omitted: true }
        : { explicit: requirePosCurrency(input.currency) },
    dueSchedule:
      normalized.dueSchedule?.map((row) => ({
        dueOn: row.dueOn,
        amount: minorToDecimal(moneyMinor(row.amount, { exact: true })),
      })) ?? null,
    note: input.note ?? null,
  };
  return createHash('sha256').update(JSON.stringify(intent)).digest('hex');
}

export function planRequestHashV2(
  input: PlanInput,
  normalized: { total: number; dueSchedule: DueInstalment[] | null },
): string {
  const clientKey = canonicalWalletClientKey(input.clientKey);
  const intent = {
    version: 2,
    clientKey,
    partyId: normalizedId(input.client.partyId),
    crmContactId: normalizedId(input.client.crmContactId),
    productId: normalizedId(input.productId),
    bookingId: normalizedId(input.bookingId),
    title: input.title.trim(),
    total: minorToDecimal(moneyMinor(normalized.total, { numeric12: true })),
    currency:
      input.currency === undefined
        ? { omitted: true }
        : { explicit: requirePosCurrency(input.currency) },
    dueSchedule:
      normalized.dueSchedule?.map((row) => ({
        dueOn: row.dueOn,
        amount: minorToDecimal(moneyMinor(row.amount, { exact: true })),
      })) ?? null,
    note: input.note ?? null,
  };
  return createHash('sha256').update(JSON.stringify(intent)).digest('hex');
}

export async function lockPlanOperation(
  tx: CoreTx,
  orgId: string,
  operationId: string,
): Promise<void> {
  // Hash collisions only serialize unrelated requests; database predicates remain exact.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['pos-plan-operation-v1', orgId, operationId])}, 0))`,
  );
}

export async function admitPlanOperation(
  tx: CoreTx,
  ctx: CoreCtx,
  input: PlanInput,
  normalized: { total: number; dueSchedule: DueInstalment[] | null },
) {
  if (input.operationId === undefined) return null;
  const operationId = planOperationId(input.operationId);
  const actorId = operationActor(ctx);
  await lockPlanOperation(tx, ctx.tenantId, operationId);
  const [cancelled] = await tx
    .select({ createdBy: posPlanOperationCancellations.createdBy })
    .from(posPlanOperationCancellations)
    .where(
      and(
        eq(posPlanOperationCancellations.orgId, ctx.tenantId),
        eq(posPlanOperationCancellations.operationId, operationId),
      ),
    )
    .limit(1);
  if (cancelled) {
    if (cancelled.createdBy !== actorId) throw operationConflict();
    throw new PosError('This operation was cancelled before creation.', 'operation_cancelled');
  }
  const [existing] = await tx
    .select()
    .from(posPaymentPlans)
    .where(
      and(eq(posPaymentPlans.orgId, ctx.tenantId), eq(posPaymentPlans.operationId, operationId)),
    )
    .limit(1);
  if (existing) {
    const operationHash =
      existing.operationVersion === 2
        ? planRequestHashV2(input, normalized)
        : planRequestHash(input, normalized);
    if (existing.createdBy !== actorId || existing.operationHash !== operationHash)
      throw operationConflict();
    return { operationId, operationHash, actorId, existing };
  }
  // An absent legacy operation has no frozen canonical identity. It must not
  // create under today's bridge; only an existing v1 receipt may replay.
  const operationHash = planRequestHashV2(input, normalized);
  return { operationId, operationHash, actorId, existing: null };
}

function operationConflict(): PosError {
  return new PosError(
    'Operation identity conflicts with an existing request.',
    'operation_conflict',
  );
}

/** Create-authorized receipt lookup deliberately exposes no client, amount or request hash. */
export async function lookupOwnPlanOperation(
  ctx: CoreCtx,
  rawId: unknown,
): Promise<{ id: string; clientKey: string; identityVersion: 1 | 2 } | null> {
  const operationId = planOperationId(rawId);
  const actorId = operationActor(ctx);
  return withOrgCore(ctx, async (tx) => {
    const [plan] = await tx
      .select({
        id: posPaymentPlans.id,
        partyId: posPaymentPlans.partyId,
        crmContactId: posPaymentPlans.crmContactId,
        operationVersion: posPaymentPlans.operationVersion,
        operationClientKey: posPaymentPlans.operationClientKey,
      })
      .from(posPaymentPlans)
      .where(
        and(
          eq(posPaymentPlans.orgId, ctx.tenantId),
          eq(posPaymentPlans.operationId, operationId),
          eq(posPaymentPlans.createdBy, actorId),
        ),
      )
      .limit(1);
    if (!plan) return null;
    const clientKey =
      plan.operationVersion === 2
        ? canonicalWalletClientKey(plan.operationClientKey)
        : plan.partyId
          ? `party:${plan.partyId}`
          : plan.crmContactId
            ? `contact:${plan.crmContactId}`
            : null;
    if (!clientKey)
      throw new PosError('Stored operation identity is unavailable.', 'invalid_stored_amount');
    return {
      id: plan.id,
      clientKey,
      identityVersion: plan.operationVersion === 2 ? 2 : 1,
    };
  });
}

export type PlanOperationCancellation =
  { status: 'cancelled' } | { status: 'committed'; plan: { id: string } };

/** Cancel admission only. The same lock ensures a delayed create can never cross this tombstone. */
export async function cancelPlanOperation(
  ctx: CoreCtx,
  rawId: unknown,
): Promise<PlanOperationCancellation> {
  const operationId = planOperationId(rawId);
  const actorId = operationActor(ctx);
  return withOrgCore(ctx, async (tx) => {
    await lockPlanOperation(tx, ctx.tenantId, operationId);
    const [plan] = await tx
      .select({ id: posPaymentPlans.id, createdBy: posPaymentPlans.createdBy })
      .from(posPaymentPlans)
      .where(
        and(eq(posPaymentPlans.orgId, ctx.tenantId), eq(posPaymentPlans.operationId, operationId)),
      )
      .limit(1);
    if (plan) {
      if (plan.createdBy !== actorId) throw operationConflict();
      return { status: 'committed', plan: { id: plan.id } };
    }
    const [existing] = await tx
      .select({ createdBy: posPlanOperationCancellations.createdBy })
      .from(posPlanOperationCancellations)
      .where(
        and(
          eq(posPlanOperationCancellations.orgId, ctx.tenantId),
          eq(posPlanOperationCancellations.operationId, operationId),
        ),
      )
      .limit(1);
    if (existing && existing.createdBy !== actorId) throw operationConflict();
    if (!existing)
      await tx
        .insert(posPlanOperationCancellations)
        .values({ orgId: ctx.tenantId, operationId, createdBy: actorId });
    return { status: 'cancelled' };
  });
}
