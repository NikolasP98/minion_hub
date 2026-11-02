import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as pgSchema from '@minion-stack/db/pg';
import { afterAll, describe, expect, it } from 'vitest';
import type { CoreCtx } from '$server/auth/core-ctx';
import { testDatabaseUrl } from '$server/test-utils/test-db-url';
import { BASE_MODULES } from '$lib/modules/availability';
import { installBaseModules, ORG_LANDING_DEFAULT } from './module-install.service';

const databaseUrl = testDatabaseUrl();
const admin = databaseUrl ? postgres(databaseUrl, { max: 1, prepare: false }) : null;
const appClient = databaseUrl ? postgres(databaseUrl, { max: 1, prepare: false }) : null;
const appDb = appClient ? drizzle(appClient, { schema: pgSchema }) : null;
const orgs: string[] = [];

function freshOrg(): CoreCtx {
  const tenantId = `module-install-${randomUUID()}`;
  orgs.push(tenantId);
  return { db: appDb as unknown as CoreCtx['db'], tenantId };
}

async function moduleRows(orgId: string) {
  const rows = await admin!<{ module_id: string; enabled: boolean }[]>`
    select module_id, enabled from app_modules where org_id = ${orgId}`;
  return Object.fromEntries(rows.map((r) => [r.module_id, r.enabled]));
}

async function landingPage(orgId: string) {
  const [row] = await admin!<{ landing: string | null }[]>`
    select value->>'landingPage' as landing from app_nav_config where org_id = ${orgId}`;
  return row?.landing ?? null;
}

describe.runIf(Boolean(databaseUrl))('installBaseModules against PostgreSQL', () => {
  afterAll(async () => {
    if (orgs.length) {
      await admin!`delete from app_modules where org_id = any(${orgs})`;
      await admin!`delete from app_nav_config where org_id = any(${orgs})`;
    }
    await Promise.all([admin?.end(), appClient?.end()]);
  });

  it('writes one row per toggle module with the base set and the business landing page', async () => {
    const ctx = freshOrg();
    await expect(installBaseModules(ctx, 'business')).resolves.toEqual({
      rowsWritten: 8,
      landingSet: true,
    });
    expect(await moduleRows(ctx.tenantId)).toEqual(BASE_MODULES);
    expect(await landingPage(ctx.tenantId)).toBe(ORG_LANDING_DEFAULT.business);
  });

  it('a second run writes zero rows and keeps the landing page', async () => {
    const ctx = freshOrg();
    await installBaseModules(ctx, 'business');
    await expect(installBaseModules(ctx, 'business')).resolves.toEqual({
      rowsWritten: 0,
      landingSet: false,
    });
    expect(await moduleRows(ctx.tenantId)).toEqual(BASE_MODULES);
  });

  it('keeps a pre-existing support = true row', async () => {
    const ctx = freshOrg();
    await admin!`insert into app_modules (org_id, module_id, enabled) values (${ctx.tenantId}, 'support', true)`;
    await expect(installBaseModules(ctx, 'business')).resolves.toMatchObject({ rowsWritten: 7 });
    expect((await moduleRows(ctx.tenantId)).support).toBe(true);
  });

  it('sets the landing page only when the document lacks one', async () => {
    const owned = freshOrg();
    await admin!`insert into app_nav_config (org_id, value) values (${owned.tenantId},
      ${admin!.json({ version: 1, sections: [], builtinSections: {}, builtin: {}, landingPage: '/crm' })})`;
    await expect(installBaseModules(owned, 'business')).resolves.toMatchObject({
      landingSet: false,
    });
    expect(await landingPage(owned.tenantId)).toBe('/crm');

    const personal = freshOrg();
    await expect(installBaseModules(personal, 'personal')).resolves.toMatchObject({
      landingSet: true,
    });
    expect(await landingPage(personal.tenantId)).toBe(ORG_LANDING_DEFAULT.personal);
  });
});
