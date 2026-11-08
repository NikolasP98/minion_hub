import { error } from '@sveltejs/kit';
import { eq, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from './core-ctx';
import {
  currentEffectiveAuthority,
  currentRequestAuthority,
  simulationAuditContext,
} from './effective-authority';
import { apiWriteCapability, type PermAction } from '$server/services/rbac.service';

type RecordModule = 'crm' | 'sales' | 'support';
type ActorScope = Pick<CoreCtx, 'tenantId' | 'profileId'>;
const TABLES: Record<RecordModule, string> = {
  crm: 'crm_contacts',
  sales: 'sales_orders',
  support: 'support_issues',
};

/** Use one record policy for selected and actual browser roles. Independent jobs have no request scope. */
function recordAuthority(ctx: ActorScope) {
  if (!ctx.profileId && simulationAuditContext(ctx.tenantId, null))
    throw error(403, 'Actor context required during role simulation');
  const selected = ctx.profileId && currentEffectiveAuthority(ctx.tenantId, ctx.profileId);
  if (selected) return selected;
  const actual = currentRequestAuthority(ctx.tenantId, ctx.profileId ?? undefined);
  return actual && !actual.platformAdmin ? { ...actual, invalid: false } : undefined;
}
/** An empty/invalid role is never an unrestricted role. */
export function simulatedMutationOwner(
  ctx: ActorScope,
  module: RecordModule,
  action: PermAction,
): string | undefined {
  const scope = recordAuthority(ctx);
  if (!scope) return undefined;
  if (
    scope.invalid ||
    !scope.capabilities.can(module, 'view') ||
    !scope.capabilities.can(module, action)
  )
    throw error(403, `${module}: ${action} required`);
  return scope.capabilities.ownerScoped(module) ? scope.profileId : undefined;
}
export function simulatedMutationPredicate(
  ctx: ActorScope,
  module: RecordModule,
  action: PermAction,
  owner: AnyColumn,
): SQL | undefined {
  const profileId = simulatedMutationOwner(ctx, module, action);
  return profileId ? eq(owner, profileId) : undefined;
}
/** Existing low-level atomic setters carry org but not ctx; bind to the current verified actor. */
export function simulatedOrgMutationPredicate(
  orgId: string,
  module: RecordModule,
  action: PermAction,
  owner: AnyColumn,
): SQL | undefined {
  const scope = simulationAuditContext(orgId, null) ?? currentRequestAuthority(orgId);
  return scope
    ? simulatedMutationPredicate(
        { tenantId: orgId, profileId: scope.profileId },
        module,
        action,
        owner,
      )
    : undefined;
}
export function simulatedOwnerAssignment(
  ctx: ActorScope,
  module: RecordModule,
  action: PermAction,
  ownerId: string | null | undefined,
  creating = false,
): string | null | undefined {
  const owner = simulatedMutationOwner(ctx, module, action);
  if (!owner) return ownerId;
  if (creating && ownerId == null) return owner;
  if (ownerId !== undefined && ownerId !== owner)
    throw error(403, 'This role cannot transfer record ownership');
  return ownerId;
}
/** Parent lock covers every child effect, even when a route omitted its own check. */
export async function assertSimulatedRecordAccess(
  tx: CoreTx,
  ctx: ActorScope,
  module: RecordModule,
  id: string,
  action: PermAction,
): Promise<void> {
  const owner = simulatedMutationOwner(ctx, module, action);
  if (!owner) return;
  const rows = await tx.execute<{ id: string } & Record<string, unknown>>(sql`
    select id from ${sql.identifier(TABLES[module])}
    where id=${id}::uuid and org_id=${ctx.tenantId} and owner_id=${owner}::uuid for update
  `);
  if (!rows[0]) throw error(404, 'Record not found');
}
/** Shared party edits affect every CRM facet: all affected records must be owned. */
export async function assertSimulatedPartyAccess(
  tx: CoreTx,
  ctx: ActorScope,
  partyId: string,
  action: PermAction = 'edit',
): Promise<void> {
  const owner = simulatedMutationOwner(ctx, 'crm', action);
  if (!owner) return;
  const rows = await tx.execute<
    { id: string; owner_id: string | null } & Record<string, unknown>
  >(sql`
    select id,owner_id from crm_contacts where org_id=${ctx.tenantId} and party_id=${partyId}::uuid for update
  `);
  if (!rows.length || rows.some((row) => row.owner_id !== owner))
    throw error(404, 'Record not found');
}
export function requireUnscopedSimulationMutation(
  ctx: ActorScope,
  module: RecordModule,
  action: PermAction,
): void {
  if (simulatedMutationOwner(ctx, module, action))
    throw error(403, 'This operation requires access to all organization records');
}

/** Preserve the canonical POS/scheduling customer-registration alternatives. */
export function simulatedRegistrationOwner(ctx: ActorScope): string | undefined {
  const scope = recordAuthority(ctx);
  if (!scope) return undefined;
  const registration = apiWriteCapability('/api/crm/parties', 'POST');
  const choices = registration
    ? [{ module: registration.module, action: registration.action }, ...(registration.anyOf ?? [])]
    : [];
  if (
    scope.invalid ||
    !choices.some(
      (choice) =>
        scope.capabilities.can(choice.module, 'view') &&
        scope.capabilities.can(choice.module, choice.action),
    )
  )
    throw error(403, 'Customer registration is unavailable for this role');
  return scope.capabilities.ownerScoped('crm') ? scope.profileId : undefined;
}
/** Registration may create a new facet; it cannot backfill another owner's existing facet. */
export async function assertSimulatedRegistrationPartyAccess(
  tx: CoreTx,
  ctx: ActorScope,
  partyId: string,
): Promise<void> {
  const owner = simulatedRegistrationOwner(ctx);
  if (!owner) return;
  const rows = await tx.execute<
    { id: string; owner_id: string | null } & Record<string, unknown>
  >(sql`
    select id,owner_id from crm_contacts where org_id=${ctx.tenantId} and party_id=${partyId}::uuid for update
  `);
  if (rows.some((row) => row.owner_id !== owner)) throw error(404, 'Record not found');
}

/** Legacy/public factories carry org only; only an admitted matching actor is bound. */
export function simulatedActorForOrg(orgId: string): ActorScope | undefined {
  const scope = simulationAuditContext(orgId, null) ?? currentRequestAuthority(orgId);
  return scope ? { tenantId: orgId, profileId: scope.profileId } : undefined;
}
export async function assertSimulatedRegistrationContactAccess(
  tx: CoreTx,
  ctx: ActorScope,
  id: string,
): Promise<void> {
  const owner = simulatedRegistrationOwner(ctx);
  if (!owner) return;
  const rows = await tx.execute<{ id: string } & Record<string, unknown>>(sql`
    select id from crm_contacts where id=${id}::uuid and org_id=${ctx.tenantId} and owner_id=${owner}::uuid for update
  `);
  if (!rows[0]) throw error(404, 'Record not found');
}
