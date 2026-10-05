import { getPgClient } from '$server/db/pg-pool';
import type { Requester } from './requests.service';

/** System-owned reads for an authenticated applicant before org membership exists. */
export const PENDING_REQUEST_LIMIT = 50;
const TABLES = { requests: 'public.join_request', organizations: 'public.organizations' } as const;
export type PendingRequestTables = { requests: string; organizations: string };
export type PendingRequestIdentity = { id: string; status: 'pending' };
export interface OwnPendingRequest {
  id: string;
  organizationName: string;
  createdAt: string;
}
export interface OwnPendingRequests {
  kind: 'none' | 'one' | 'many';
  requests: OwnPendingRequest[];
  hasMore: boolean;
}

export class JoinRequestUnavailable extends Error {
  readonly code = 'join_request_unavailable';
  constructor() {
    super('Access requests are temporarily unavailable. Please try again.');
  }
}

/** The partial unique index is the final arbiter across processes and retries. */
export async function admitPendingRequest(
  who: Requester,
  organizationId: string,
  message?: string,
  tables: PendingRequestTables = TABLES,
): Promise<{ request: PendingRequestIdentity; created: boolean }> {
  try {
    return await getPgClient().begin(async (tx) => {
      await tx`set local statement_timeout = '3s'`;
      await tx`set local lock_timeout = '2s'`;
      const [inserted] = await tx<PendingRequestIdentity[]>`
        insert into ${tx(tables.requests)}
          (supabase_id,user_id,email,display_name,message,status,organization_id,requested_role)
        values (${who.supabaseId},${who.id},${who.email},${who.displayName},${message ?? null},
          'pending',${organizationId},'user')
        on conflict (user_id,organization_id) where status='pending' do nothing
        returning id,status
      `;
      if (inserted) return { request: inserted, created: true };
      // A concurrent winner is committed before the unique check completes. This
      // new statement uses READ COMMITTED to observe it without another insert.
      const [existing] = await tx<PendingRequestIdentity[]>`
        select id,status from ${tx(tables.requests)}
        where user_id=${who.id} and organization_id=${organizationId} and status='pending'
        limit 1
      `;
      if (!existing) throw new JoinRequestUnavailable();
      return { request: existing, created: false };
    });
  } catch {
    // Provider SQL/errors can contain applicant content. The public boundary is fixed.
    throw new JoinRequestUnavailable();
  }
}

/** A target-aware form must not be blocked by a request to another workspace. */
export async function readOwnPendingRequestForOrganization(
  userId: string,
  organizationId: string,
  tables: PendingRequestTables = TABLES,
): Promise<PendingRequestIdentity | null> {
  try {
    return await getPgClient().begin(async (tx) => {
      await tx`set local statement_timeout = '3s'`;
      const [row] = await tx<PendingRequestIdentity[]>`
        select id,status from ${tx(tables.requests)}
        where user_id=${userId} and organization_id=${organizationId} and status='pending'
        limit 1
      `;
      return row ?? null;
    });
  } catch {
    throw new JoinRequestUnavailable();
  }
}

/** Never pick one org on a no-target page; project only this applicant's safe fields. */
export async function readOwnPendingRequests(
  userId: string,
  tables: PendingRequestTables = TABLES,
): Promise<OwnPendingRequests> {
  try {
    const rows = await getPgClient().begin(async (tx) => {
      await tx`set local statement_timeout = '3s'`;
      return tx<{ id: string; organization_name: string | null; created_at: Date }[]>`
        select r.id,left(o.name,160) as organization_name,r.created_at
        from ${tx(tables.requests)} r
        left join ${tx(tables.organizations)} o on o.id::text=r.organization_id
        where r.user_id=${userId} and r.status='pending'
        order by r.created_at asc,r.id asc
        limit ${PENDING_REQUEST_LIMIT + 1}
      `;
    });
    const requests = rows.slice(0, PENDING_REQUEST_LIMIT).map((row) => ({
      id: row.id,
      organizationName: row.organization_name ?? 'Workspace',
      createdAt: row.created_at.toISOString(),
    }));
    return {
      kind: requests.length === 0 ? 'none' : requests.length === 1 ? 'one' : 'many',
      requests,
      hasMore: rows.length > PENDING_REQUEST_LIMIT,
    };
  } catch {
    throw new JoinRequestUnavailable();
  }
}
