#!/usr/bin/env bun
/** Read-only rollout inventory. Contains phone metadata: keep output private. */
import postgres from 'postgres';
const url = process.env.SUPABASE_DB_URL;
if (!url) throw new Error('SUPABASE_DB_URL required; no environment file is loaded');
const db = postgres(url, {
  max: 1,
  prepare: false,
  connection: { default_transaction_read_only: true, statement_timeout: 10000 },
});
try {
  const rows =
    await db`select c.id,c.tenant_id,c.gateway_id,c.account_id,c.owner_profile_id,c.auth_ref,
   to_jsonb(c)->>'provider_account_id' as provider_account_id,to_jsonb(c)->>'provider_account_verified_at' as provider_account_verified_at,c.enabled,c.replies,c.settings->>'assistantMode' as assistant_mode,
   g.org_id as gateway_org,
   count(*) over(partition by to_jsonb(c)->>'provider_account_id') as canonical_aliases,
   count(*) over(partition by c.auth_ref) as auth_aliases
   from channels c left join gateway g on g.id=c.gateway_id where c.type='whatsapp' order by c.tenant_id,c.id`;
  console.log(
    JSON.stringify(
      rows.map((r) => ({
        ...r,
        qualified:
          !!r.provider_account_id &&
          !r.owner_profile_id &&
          r.gateway_org === r.tenant_id &&
          Number(r.canonical_aliases) === 1 &&
          !!r.auth_ref &&
          Number(r.auth_aliases) === 1,
      })),
      null,
      2,
    ),
  );
} finally {
  await db.end();
}
