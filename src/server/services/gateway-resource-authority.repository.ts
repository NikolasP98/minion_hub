import { sql } from 'drizzle-orm';
import { gateway } from '@minion-stack/db/pg';
import { getCoreDb } from '$server/db/pg-client';

/** Canonical system-auth query. Never expose these columns in an HTTP response/log. */
export function readGatewayCredentials(serverId: string) {
  return getCoreDb()
    .select({
      id: gateway.id,
      legacyServerId: gateway.legacyServerId,
      url: gateway.url,
      authMode: gateway.authMode,
      token: gateway.tokenCiphertext,
      tokenIv: gateway.tokenIv,
    })
    .from(gateway).where(sql`${gateway.url} in (
    select url from public.gateway where id::text = ${serverId} or legacy_server_id = ${serverId}
  )`);
}

/** One database snapshot checks membership, shared-machine assignment and save ownership. */
export async function readWorkshopAuthority(input: {
  gatewayIds: string[];
  userId: string;
  orgId: string;
  saveId: string;
}): Promise<{ member: boolean; gateway: boolean; save: boolean }> {
  const rows = await getCoreDb().execute(sql`
    select
      exists(select 1 from public.organization_members
        where profile_id = ${input.userId}::uuid and organization_id = ${input.orgId}::uuid) as member,
      exists(select 1 from public.gateway g
        where g.id in (${sql.join(
          input.gatewayIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})
          and (g.org_id = ${input.orgId}::uuid or exists(
            select 1 from public.channels c where c.gateway_id = g.id and c.tenant_id = ${input.orgId}::uuid
          ))) as gateway,
      exists(select 1 from public.workshop_saves
        where id = ${input.saveId} and tenant_id = ${input.orgId}::uuid) as save
  `);
  const row = rows[0];
  if (!row) throw new Error('Missing authority result');
  return { member: row.member === true, gateway: row.gateway === true, save: row.save === true };
}
