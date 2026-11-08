/** Native QA qualification: real GoTrue sessions and production session/audit tables. */
import type { RequestEvent } from '@sveltejs/kit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { configureCache, createBackend } from '@minion-stack/cache';
import { assertLoopback } from '../../../scripts/qa/seed/db';
import { ORG_BUSINESS, ORG_PERSONAL } from '../../../scripts/qa/seed/tenancy';
import { INITIAL_SIMULATION_GENERATION } from '$lib/role-simulation';
import {
  runWithEffectiveAuthority,
  runWithRequestCapabilities,
} from '$server/auth/effective-authority';
import { getCoreDb } from '$server/db/pg-client';
import { withOrgCore } from '$server/db/with-org-core';
import { docAuditLog } from '$server/db/pg-activity-schema';
import { resolveCapabilities } from './rbac.service';
import {
  admitRoleSimulation,
  loadRoleSimulationState,
  transitionRoleSimulation,
} from './role-simulation.service';

type VerifiedLocals = App.Locals & {
  authSessionId: string;
  user: NonNullable<App.Locals['user']> & { supabaseId: string };
};
const enabled =
  process.env.REQUIRE_ROLE_SIMULATION_POSTGRES === '1' ||
  process.env.REQUIRE_QA_NATIVE_POSTGRES === '1';
describe.skipIf(!enabled)('role simulation native session admission', () => {
  let pg: ReturnType<typeof postgres>;
  let owner: VerifiedLocals;
  let viewer: VerifiedLocals;
  let ownerToken = '';
  const sessions: string[] = [];
  const generations: string[] = [];
  const auditRefs: string[] = [];
  const foreignRole = `custom-native-foreign-${crypto.randomUUID().slice(0, 8)}`;
  const event = (locals = owner) =>
    ({
      locals: { ...locals, user: { ...locals.user! } },
      url: new URL('http://127.0.0.1:5199/en/crm/customers'),
      request: new Request('http://127.0.0.1:5199/en/crm/customers'),
      route: { id: '/(app)/crm/customers' },
    }) as unknown as RequestEvent;
  beforeAll(async () => {
    // The global test setup uses noop; this lane must exercise a genuinely warm cache.
    configureCache({
      namespace: `role-simulation-native-${crypto.randomUUID()}`,
      backend: createBackend({ backend: 'memory' }),
    });
    const db = assertLoopback(process.env.HUB_TEST_DB_URL, 'HUB_TEST_DB_URL');
    expect(process.env.SUPABASE_DB_URL).toBe(db);
    const api = assertLoopback(process.env.PUBLIC_SUPABASE_URL, 'PUBLIC_SUPABASE_URL');
    pg = postgres(db, { max: 3, prepare: false });
    const client = createClient(api, process.env.PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    async function login(persona: 'OWNER' | 'VIEWER') {
      const { data, error } = await client.auth.signInWithPassword({
        email: process.env[`QA_${persona}_EMAIL`]!,
        password: process.env[`QA_${persona}_PASSWORD`]!,
      });
      if (error || !data.session || !data.user)
        throw error ?? new Error('QA login did not create a session');
      const verified = await client.auth.getClaims(data.session.access_token);
      expect(verified.error).toBeNull();
      const claims = verified.data!.claims;
      const sessionId = String(claims.session_id);
      sessions.push(sessionId);
      const locals: VerifiedLocals = {
        user: {
          id: data.user.id,
          supabaseId: data.user.id,
          email: data.user.email!,
          displayName: 'Native QA',
          role: 'user',
        },
        authSessionId: sessionId,
        orgId: ORG_BUSINESS,
        orgKind: 'business',
        tenantCtx: { db: {} as never, tenantId: ORG_BUSINESS },
      };
      return { locals, token: data.session.access_token };
    }
    const actualOwner = await login('OWNER');
    owner = actualOwner.locals;
    ownerToken = actualOwner.token;
    viewer = (await login('VIEWER')).locals;
    await pg`insert into org_roles(org_id,key,name,rank,source_role_key,created_by) values(${ORG_PERSONAL},${foreignRole},'Foreign only',10,'viewer',${owner.user!.supabaseId})`;
  }, 30_000);
  afterAll(async () => {
    configureCache({ namespace: 'test', backend: createBackend({ backend: 'noop' }) });
    if (!pg) return;
    await pg`delete from doc_audit_log where ref_type in ('role_simulation','simulation_native') and ref_id::text in ${pg([...generations, ...auditRefs].length ? [...generations, ...auditRefs] : ['none'])}`;
    if (sessions.length) await pg`delete from auth.sessions where id::text in ${pg(sessions)}`;
    await pg`delete from org_roles where org_id=${ORG_PERSONAL} and key=${foreignRole}`;
    await pg.end();
  });
  it('rejects foreign roles and non-admin actors without changing membership', async () => {
    await expect(
      loadRoleSimulationState({ ...owner, authSessionId: viewer.authSessionId }),
    ).rejects.toMatchObject({ status: 401 });
    const state = await loadRoleSimulationState(owner);
    expect(state.eligible).toBe(true);
    expect((await resolveCapabilities(ORG_BUSINESS, owner.user!.supabaseId!)).roles).toContain(
      'owner',
    );
    expect(state.roles.some((r) => r.key === 'custom-qa-access' && r.selectable)).toBe(true);
    expect(state.roles.some((r) => r.key === foreignRole)).toBe(false);
    await expect(
      transitionRoleSimulation(owner, {
        generation: state.generation,
        returnTo: '/en/crm/customers',
        roleKey: foreignRole,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      transitionRoleSimulation(viewer, {
        generation: INITIAL_SIMULATION_GENERATION,
        returnTo: '/en/crm/customers',
        roleKey: 'staff',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it('keeps mode rows inaccessible to browser database roles', async () => {
    await expect(
      pg.begin(async (tx) => {
        await tx`set local role authenticated`;
        await tx`select role_key from public.app_role_simulations`;
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });
  it('ignores warmed real-role rows after a policy commit without cache invalidation', async () => {
    const profileId = viewer.user!.supabaseId!;
    expect((await resolveCapabilities(ORG_BUSINESS, profileId)).can('crm', 'view')).toBe(true);
    const old =
      await pg`select * from permission_rules where org_id=${ORG_BUSINESS}::uuid and role_key='viewer' and module='crm'`;
    try {
      await pg`insert into permission_rules(org_id,role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level)
        values(${ORG_BUSINESS}::uuid,'viewer','crm',false,false,false,false,false,false,false,0)
        on conflict(org_id,role_key,module) do update set can_view=false,can_create=false,can_edit=false,can_delete=false,can_export=false,can_manage=false`;
      // Negative control: the legacy cache really still holds the previous grant.
      expect((await resolveCapabilities(ORG_BUSINESS, profileId)).can('crm', 'view')).toBe(true);
      const ev = event(viewer);
      expect(await admitRoleSimulation(ev)).toBeUndefined();
      const fresh = await runWithRequestCapabilities(ev.locals.requestCapabilities, () =>
        resolveCapabilities(ORG_BUSINESS, profileId),
      );
      expect(fresh.can('crm', 'view')).toBe(false);
    } finally {
      await pg`delete from permission_rules where org_id=${ORG_BUSINESS}::uuid and role_key='viewer' and module='crm'`;
      if (old[0]) await pg`insert into permission_rules ${pg(old[0])}`;
    }
  });
  it('serializes concurrent first Starts, replaces roles and atomically records actual identity', async () => {
    const results = await Promise.allSettled(
      ['viewer', 'staff'].map((roleKey) =>
        transitionRoleSimulation(owner, {
          generation: INITIAL_SIMULATION_GENERATION,
          returnTo: '/en/crm/customers',
          roleKey,
        }),
      ),
    );
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    expect(succeeded).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const receipt = (
      succeeded[0] as PromiseFulfilledResult<{ generation: string; location: string }>
    ).value;
    generations.push(receipt.generation);
    const ev = event();
    const scope = await admitRoleSimulation(ev);
    expect(scope?.roleKey).toMatch(/^(viewer|staff)$/);
    const caps = await runWithEffectiveAuthority(scope, () =>
      resolveCapabilities(ORG_BUSINESS, owner.user!.supabaseId!),
    );
    expect(caps.roles).toEqual([scope!.roleKey]);
    expect(caps.can('users', 'manage')).toBe(false);
    for (const actorId of [null, viewer.user!.supabaseId!]) {
      const refId = crypto.randomUUID();
      auditRefs.push(refId);
      await runWithEffectiveAuthority(scope, () =>
        withOrgCore(
          { db: getCoreDb(), tenantId: ORG_BUSINESS, profileId: owner.user!.supabaseId },
          async (tx) => {
            await tx.insert(docAuditLog).values({
              orgId: ORG_BUSINESS,
              refType: 'simulation_native',
              refId,
              actorId,
              actorName: 'Spoofed actor',
              op: 'update',
              changes: [{ field: 'test', old: 0, new: 1 }],
              simulationRoleKey: 'owner',
              simulationGeneration: crypto.randomUUID(),
            });
          },
        ),
      );
      const rows =
        await pg`select actor_id::text,actor_name,simulation_role_key,simulation_generation::text from doc_audit_log where ref_id=${refId}::uuid`;
      expect(rows[0]).toMatchObject({
        actor_id: owner.user!.supabaseId,
        actor_name: 'Native QA',
        simulation_role_key: scope!.roleKey,
        simulation_generation: receipt.generation,
      });
    }
    const members =
      await pg`select role_key from member_roles where org_id=${ORG_BUSINESS}::uuid and profile_id=${owner.user!.supabaseId}::uuid`;
    expect(members.map((r) => r.role_key)).toContain('owner');
    const audits =
      await pg`select actor_id::text,simulation_role_key,simulation_generation::text from doc_audit_log where ref_type='role_simulation' and ref_id=${receipt.generation}::uuid`;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_id: owner.user!.supabaseId,
      simulation_role_key: scope!.roleKey,
      simulation_generation: receipt.generation,
    });
  });
  it('reads the committed generation after waiting behind an in-progress transition lock', async () => {
    const blocker = postgres(process.env.HUB_TEST_DB_URL!, { max: 1, prepare: false });
    const next = crypto.randomUUID();
    generations.push(next);
    let pending: Promise<Awaited<ReturnType<typeof admitRoleSimulation>>>;
    try {
      await blocker.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${owner.authSessionId!},113))`;
        pending = admitRoleSimulation(event());
        let blocked = false;
        for (let i = 0; i < 150; i++) {
          const rows =
            await pg`select 1 from pg_locks where locktype='advisory' and mode='ShareLock' and granted=false`;
          if (rows.length) {
            blocked = true;
            break;
          }
          await new Promise((done) => setTimeout(done, 10));
        }
        expect(blocked).toBe(true);
        await tx`update app_role_simulations set generation=${next}::uuid,role_key='staff' where session_id=${owner.authSessionId}::uuid`;
      });
      const admitted = await pending!;
      expect(admitted?.generation).toBe(next);
      expect(admitted?.roleKey).toBe('staff');
    } finally {
      await blocker.end();
    }
  });
  it('restricts expired mode until Finish, then rotates off generation and restores an authorized original URL', async () => {
    await pg`update app_role_simulations set expires_at=now()-interval '1 minute' where session_id=${owner.authSessionId}::uuid`;
    const ev = event();
    const scope = await admitRoleSimulation(ev);
    expect(scope?.invalid).toBe(true);
    expect(scope?.capabilities.visibleModules()).toEqual([]);
    const state = await loadRoleSimulationState(owner);
    const receipt = await transitionRoleSimulation(owner, {
      generation: state.generation,
      returnTo: '/en/account/home',
    });
    generations.push(receipt.generation);
    expect(receipt.location).toBe('/en/crm/customers');
    const off = await loadRoleSimulationState(owner);
    expect(off.active).toBe(false);
    expect(off.generation).toBe(receipt.generation);
    expect(off.generation).not.toBe(INITIAL_SIMULATION_GENERATION);
  });
  it('keeps a deleted selected role restricted and still permits authenticated Finish', async () => {
    const key = `custom-transient-${crypto.randomUUID().slice(0, 8)}`;
    await pg`insert into org_roles(org_id,key,name,rank,source_role_key,created_by) values(${ORG_BUSINESS},${key},'Temporary native role',10,'viewer',${owner.user!.supabaseId})`;
    try {
      const state = await loadRoleSimulationState(owner);
      const start = await transitionRoleSimulation(owner, {
        generation: state.generation,
        returnTo: '/en/crm/customers',
        roleKey: key,
      });
      generations.push(start.generation);
      await pg`delete from org_roles where org_id=${ORG_BUSINESS} and key=${key}`;
      const scope = await admitRoleSimulation(event());
      expect(scope?.invalid).toBe(true);
      expect(scope?.capabilities.can('crm', 'edit')).toBe(false);
      const finish = await transitionRoleSimulation(owner, {
        generation: start.generation,
        returnTo: '/en/account/home',
      });
      generations.push(finish.generation);
      expect((await loadRoleSimulationState(owner)).active).toBe(false);
    } finally {
      await pg`delete from org_roles where org_id=${ORG_BUSINESS} and key=${key}`;
    }
  });
  it('rejects a revoked formerly simulated session before absent-state detection with an unexpired signed token', async () => {
    const state = await loadRoleSimulationState(owner);
    const started = await transitionRoleSimulation(owner, {
      generation: state.generation,
      returnTo: '/en/crm/customers',
      roleKey: 'viewer',
    });
    generations.push(started.generation);
    const claims = JSON.parse(Buffer.from(ownerToken.split('.')[1]!, 'base64url').toString()) as {
      exp: number;
    };
    expect(claims.exp * 1000).toBeGreaterThan(Date.now());
    await pg`delete from auth.sessions where id=${owner.authSessionId}::uuid`;
    expect(
      await pg`select session_id from app_role_simulations where session_id=${owner.authSessionId}::uuid`,
    ).toHaveLength(0);
    await expect(admitRoleSimulation(event())).rejects.toMatchObject({ status: 401 });
    await expect(loadRoleSimulationState(owner)).rejects.toMatchObject({ status: 401 });
  });
});
