import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { bindUnassignedPersonalAgentGateway } from './personal-agent.service';
import type { CoreCtx } from '$server/auth/core-ctx';
const db = new PGlite();
const profile = '10000000-0000-4000-8000-000000000001';
const org = '20000000-0000-4000-8000-000000000001';
const gatewayA = '30000000-0000-4000-8000-000000000001';
const gatewayB = '30000000-0000-4000-8000-000000000002';
const ctx: CoreCtx = { db: drizzle(db) as unknown as CoreCtx['db'], tenantId: org };
beforeAll(async () => {
  await db.exec(`create table profiles(id uuid primary key);
    create table gateway(id uuid primary key, org_id uuid);
    create table organization_members(profile_id uuid, organization_id uuid);
    create table personal_agents(id uuid primary key, profile_id uuid, gateway_id uuid, provisioning_status text,
      provisioning_error text, retry_count integer, last_retry_at timestamptz, updated_at timestamptz);`);
});
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  await db.exec('truncate personal_agents, profiles, gateway, organization_members');
  await db.query('insert into profiles values($1)', [profile]);
  await db.query('insert into organization_members values($1,$2)', [profile, org]);
  await db.query('insert into gateway values($1,$3),($2,$3)', [gatewayA, gatewayB, org]);
  await db.query(
    "insert into personal_agents(id,profile_id,provisioning_status) values($1,$1,'active')",
    [profile],
  );
});
describe('canonical unassigned agent binding SQL', () => {
  it('one assignment wins and never silently relocates the existing agent', async () => {
    const results = await Promise.all([
      bindUnassignedPersonalAgentGateway(ctx, profile, gatewayA),
      bindUnassignedPersonalAgentGateway(ctx, profile, gatewayB),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const result = await db.query<{ gateway_id: string; provisioning_status: string }>(
      'select gateway_id,provisioning_status from personal_agents',
    );
    expect([gatewayA, gatewayB]).toContain(result.rows[0].gateway_id);
    expect(result.rows[0].provisioning_status).toBe('pending');
    expect(await bindUnassignedPersonalAgentGateway(ctx, profile, gatewayB)).toBe(false);
  });
  it('rejects a gateway belonging to another org', async () => {
    await db.query('update gateway set org_id=$1 where id=$2', [
      '20000000-0000-4000-8000-000000000002',
      gatewayA,
    ]);
    expect(await bindUnassignedPersonalAgentGateway(ctx, profile, gatewayA)).toBe(false);
  });
  it('rejects a removed membership', async () => {
    await db.exec('delete from organization_members');
    expect(await bindUnassignedPersonalAgentGateway(ctx, profile, gatewayA)).toBe(false);
  });
});
