import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { crmContactGuardians, crmContacts } from '$server/db/pg-crm-schema';
import { parties } from '$server/db/pg-party-schema';
import { withOrgCore } from '$server/db/with-org-core';

export interface GuardianContact {
  id: string;
  displayName: string | null;
  dob: string;
}

export class GuardianEligibilityError extends Error {}

export function isGuardianEligibilityFailure(error: unknown): boolean {
  return (
    error instanceof GuardianEligibilityError ||
    (error instanceof Error && /guardian|adult/i.test(error.message))
  );
}

export async function listGuardians(ctx: CoreCtx, wardContactId: string, ownerId?: string) {
  return withOrgCore(ctx, (tx) =>
    tx
      .select({ id: crmContacts.id, displayName: crmContacts.displayName, dob: parties.dob })
      .from(crmContactGuardians)
      .innerJoin(
        sql`crm_contacts ward`,
        sql`ward.id = ${crmContactGuardians.wardContactId} and ward.org_id = ${ctx.tenantId} and ward.deleted_at is null`,
      )
      .innerJoin(
        crmContacts,
        and(
          eq(crmContacts.id, crmContactGuardians.guardianContactId),
          eq(crmContacts.orgId, ctx.tenantId),
        ),
      )
      .innerJoin(parties, and(eq(parties.id, crmContacts.partyId), eq(parties.orgId, ctx.tenantId)))
      .where(
        and(
          eq(crmContactGuardians.orgId, ctx.tenantId),
          eq(crmContactGuardians.wardContactId, wardContactId),
          isNull(crmContacts.deletedAt),
          ...(ownerId ? [eq(crmContacts.ownerId, ownerId)] : []),
          eq(parties.type, 'person'),
        ),
      ),
  );
}

export async function listAdultGuardianCandidates(
  ctx: CoreCtx,
  wardContactId: string,
  ownerId?: string,
) {
  return withOrgCore(ctx, (tx) =>
    tx
      .select({ id: crmContacts.id, displayName: crmContacts.displayName, dob: parties.dob })
      .from(crmContacts)
      .innerJoin(parties, and(eq(parties.id, crmContacts.partyId), eq(parties.orgId, ctx.tenantId)))
      .where(
        and(
          eq(crmContacts.orgId, ctx.tenantId),
          ne(crmContacts.id, wardContactId),
          isNull(crmContacts.deletedAt),
          eq(parties.type, 'person'),
          sql`${parties.dob} <= current_date - interval '18 years'`,
          ...(ownerId ? [eq(crmContacts.ownerId, ownerId)] : []),
        ),
      )
      .orderBy(crmContacts.displayName),
  );
}

export async function addGuardian(ctx: CoreCtx, wardContactId: string, guardianContactId: string) {
  if (wardContactId === guardianContactId)
    throw new GuardianEligibilityError('A contact cannot be their own guardian');
  return withOrgCore(ctx, async (tx) => {
    const rows = await tx.execute<{ ward_id: string; guardian_id: string }>(sql`
      select w.id as ward_id, g.id as guardian_id
      from crm_contacts w
      join crm_contacts g on g.org_id = w.org_id and g.id = ${guardianContactId}
      join parties gp on gp.org_id = g.org_id and gp.id = g.party_id
      where w.org_id = ${ctx.tenantId} and w.id = ${wardContactId}
        and w.deleted_at is null and g.deleted_at is null
        and gp.type = 'person' and gp.dob <= current_date - interval '18 years'
        and w.party_id is distinct from g.party_id
    `);
    if (!rows[0])
      throw new GuardianEligibilityError(
        'Guardian must be a same-organization adult contact with a date of birth',
      );
    await tx
      .insert(crmContactGuardians)
      .values({ orgId: ctx.tenantId, wardContactId, guardianContactId })
      .onConflictDoNothing();
  });
}

export async function removeGuardian(
  ctx: CoreCtx,
  wardContactId: string,
  guardianContactId: string,
) {
  await withOrgCore(ctx, (tx) =>
    tx
      .delete(crmContactGuardians)
      .where(
        and(
          eq(crmContactGuardians.orgId, ctx.tenantId),
          eq(crmContactGuardians.wardContactId, wardContactId),
          eq(crmContactGuardians.guardianContactId, guardianContactId),
        ),
      ),
  );
}
