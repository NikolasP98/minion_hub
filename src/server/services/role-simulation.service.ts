import { parseOrganizationRolePolicy } from './organization-role-policy';
import { randomUUID } from 'node:crypto';
import { error, isHttpError, type RequestEvent } from '@sveltejs/kit';
import type postgres from 'postgres';
import { getPgClient } from '$server/db/pg-pool';
import { getCoreDb } from '$server/db/pg-client';
import {
  buildCapabilities,
  resolveMemberRoleKeys,
  type Capabilities,
  type CapabilityOverrideRow,
} from './rbac.service';
import { roleFitsActualAuthority, noSimulationCapabilities } from './role-simulation-policy';
import {
  inactiveSimulation,
  INITIAL_SIMULATION_GENERATION,
  SIMULATION_GENERATION_HEADER,
  type RoleSimulationState,
} from '$lib/role-simulation';
import type { EffectiveAuthority } from '$server/auth/effective-authority';
import { normalizeNavConfig, type NavConfig } from '$lib/nav/custom-sections';
import { simulationDestination, safeSimulationReturn } from './simulation-navigation';
import { listModuleStates } from './modules.service';
import { resolveEntitlements } from './entitlements.service';
import { getUserPreferences } from './user-preferences.service';

type Tx = postgres.TransactionSql;
interface SessionRow {
  session_id: string;
  profile_id: string | null;
  org_id: string | null;
  role_key: string | null;
  generation: string | null;
  return_to: string | null;
  expires_at: Date | string | null;
}
interface CatalogRole {
  key: string;
  name: string;
  rank: number;
}
interface AuthoritySnapshot {
  name: string;
  member: boolean;
  eligible: boolean;
  actualRoles: string[];
  platformAdmin: boolean;
  actual: Capabilities;
  rank: number;
  catalog: CatalogRole[];
  rules: CapabilityOverrideRow[];
  nav: NavConfig;
}
export class SimulationGenerationConflict extends Error {
  constructor(readonly generation: string) {
    super('Role simulation changed. Reload to continue.');
  }
}
function actor(locals: App.Locals) {
  const user = locals.actualUser ?? locals.user;
  if (!user?.supabaseId || !locals.authSessionId)
    throw error(401, 'A verified login session is required');
  return { user, profileId: user.supabaseId, sessionId: locals.authSessionId };
}
/** Live auth-session proof precedes absence detection: revocation must never restore admin. */
async function readSession(tx: Tx, profileId: string, sessionId: string): Promise<SessionRow> {
  await tx`select pg_advisory_xact_lock_shared(hashtextextended(${sessionId},113))`;
  const rows = await tx<SessionRow[]>`
    select a.id::text as session_id,s.profile_id::text,s.org_id::text,s.role_key,
           s.generation::text,s.return_to,s.expires_at
    from auth.sessions a left join public.app_role_simulations s on s.session_id=a.id
    where a.id=${sessionId}::uuid and a.user_id=${profileId}::uuid
      and (a.not_after is null or a.not_after>now())
  `;
  if (rows.length !== 1) throw error(401, 'Login session expired');
  const row = rows[0]!;
  if (row.profile_id && row.profile_id !== profileId) throw error(401, 'Login session unavailable');
  return row;
}
/** Acting browser authority is fresh even off-mode: failed tag invalidation can
 * never restore a pre-commit field/scope grant on the next document request. */
async function freshActorCapabilities(
  tx: Tx,
  orgId: string,
  profileId: string,
): Promise<Capabilities> {
  const [row] = await tx<
    {
      role: string | null;
      role_model: string | null;
      default_role_key: string | null;
      local_roles: string[];
      assigned: { role_key: string }[];
      rules: CapabilityOverrideRow[];
    }[]
  >`select m.role,to_jsonb(o)->>'role_model' as role_model,to_jsonb(o)->>'default_role_key' as default_role_key,
    coalesce((select jsonb_agg(key) from public.org_roles where org_id=${orgId}),'[]'::jsonb) as local_roles,
    coalesce((select jsonb_agg(x) from (select role_key from public.member_roles where org_id=${orgId}::uuid and profile_id=${profileId}::uuid) x),'[]'::jsonb) as assigned,
    coalesce((select jsonb_agg(x) from (select role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level from public.permission_rules
      where org_id=${orgId}::uuid and (role_key in ('owner','admin','manager','staff','viewer') or role_key in (select role_key from public.member_roles where org_id=${orgId}::uuid and profile_id=${profileId}::uuid))) x),'[]'::jsonb) as rules
    from public.organization_members m join public.organizations o on o.id=m.organization_id and o.status='active'
    where m.organization_id=${orgId}::uuid and m.profile_id=${profileId}::uuid`;
  if (!row) throw error(403, 'Active organization membership required');
  return buildCapabilities(
    resolveMemberRoleKeys(
      row.assigned.map((r) => r.role_key),
      row.role,
      parseOrganizationRolePolicy(row).roleModel,
      row.local_roles,
    ),
    row.rules,
  );
}
async function snapshot(tx: Tx, orgId: string, profileId: string): Promise<AuthoritySnapshot> {
  // One authority SELECT is a coherent statement snapshot. READ COMMITTED is
  // essential: the session advisory-lock wait must not pin an older snapshot.
  const [rows] = await tx<
    {
      members: {
        role: string | null;
        profile_role: string | null;
        name: string;
        role_model: string | null;
        default_role_key: string | null;
      }[];
      assigned: { role_key: string }[];
      catalog: CatalogRole[];
      rules: CapabilityOverrideRow[];
      nav: unknown;
    }[]
  >`select
    coalesce((select jsonb_agg(x) from (
      select m.role,p.role as profile_role,o.name,to_jsonb(o)->>'role_model' as role_model,to_jsonb(o)->>'default_role_key' as default_role_key from public.organization_members m
      join public.organizations o on o.id=m.organization_id and o.status='active'
      join public.profiles p on p.id=m.profile_id where m.organization_id=${orgId}::uuid and m.profile_id=${profileId}::uuid
    ) x),'[]'::jsonb) as members,
    coalesce((select jsonb_agg(x) from (select role_key from public.member_roles where org_id=${orgId}::uuid and profile_id=${profileId}::uuid) x),'[]'::jsonb) as assigned,
    coalesce((select jsonb_agg(x order by rank desc,key) from (select key,name,rank from public.permission_roles where coalesce((select to_jsonb(o)->>'role_model' from public.organizations o where id=${orgId}::uuid),'legacy')='legacy' union all select key,name,rank from public.org_roles where org_id=${orgId}) x),'[]'::jsonb) as catalog,
    coalesce((select jsonb_agg(x) from (select role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level from public.permission_rules where org_id=${orgId}::uuid) x),'[]'::jsonb) as rules,
    (select value from public.app_nav_config where org_id=${orgId}) as nav`;
  if (!rows) throw error(503, 'Role authority unavailable');
  const { members, assigned, catalog, rules } = rows;
  const member = members.length === 1;
  const policy = member
    ? parseOrganizationRolePolicy(members[0])
    : { roleModel: 'legacy' as const, defaultRoleKey: null };
  const actualRoles = member
    ? resolveMemberRoleKeys(
        assigned.map((r) => r.role_key),
        members[0]!.role,
        policy.roleModel,
        catalog.map((r) => r.key),
      )
    : [];
  const platformAdmin = member && members[0]?.profile_role === 'admin';
  if (
    (policy.roleModel === 'legacy' &&
      !['owner', 'admin', 'manager', 'staff', 'viewer'].every((key) =>
        catalog.some((role) => role.key === key),
      )) ||
    new Set(catalog.map((r) => r.key)).size !== catalog.length
  )
    throw error(503, 'Role catalog unavailable');
  const rank =
    policy.roleModel === 'legacy' && platformAdmin && !actualRoles.includes('owner')
      ? (catalog.find((r) => r.key === 'admin')?.rank ?? 0)
      : Math.max(0, ...catalog.filter((r) => actualRoles.includes(r.key)).map((r) => r.rank));
  return {
    name: members[0]?.name ?? '',
    member,
    actualRoles,
    platformAdmin,
    rank,
    catalog,
    rules,
    actual: buildCapabilities(actualRoles, rules),
    nav: normalizeNavConfig(rows.nav),
    eligible:
      member &&
      (platformAdmin ||
        (policy.roleModel === 'organization'
          ? buildCapabilities(actualRoles, rules).can('users', 'manage')
          : actualRoles.some((r) => r === 'owner' || r === 'admin'))),
  };
}
const selectionMemo = new WeakMap<AuthoritySnapshot, Map<string, boolean>>();
function selectable(s: AuthoritySnapshot, role: CatalogRole): boolean {
  let memo = selectionMemo.get(s);
  if (!memo) {
    memo = new Map();
    selectionMemo.set(s, memo);
  }
  if (memo.has(role.key)) return memo.get(role.key)!;
  const value =
    s.eligible &&
    role.rank <= s.rank &&
    (role.key !== 'owner' || s.actualRoles.includes('owner')) &&
    roleFitsActualAuthority({
      actual: s.actual,
      selected: buildCapabilities([role.key], s.rules),
      rules: s.rules,
      nav: s.nav,
      platformAdmin: s.platformAdmin,
    });
  memo.set(role.key, value);
  return value;
}
function project(
  row: SessionRow,
  orgId: string | null,
  s?: AuthoritySnapshot,
): RoleSimulationState {
  const active = Boolean(row.role_key);
  const role = s?.catalog.find((r) => r.key === row.role_key);
  const invalid =
    active &&
    (!s ||
      !role ||
      !selectable(s, role) ||
      !row.expires_at ||
      new Date(row.expires_at).getTime() <= Date.now());
  return {
    active,
    invalid,
    eligible: s?.eligible ?? false,
    roleKey: row.role_key,
    roleName: role?.name ?? row.role_key,
    generation: row.generation ?? INITIAL_SIMULATION_GENERATION,
    orgId: row.org_id ?? orgId,
    orgName: s?.name || null,
    roles:
      s?.eligible && !invalid
        ? s.catalog.map((r) => ({
            key: r.key,
            name: r.name,
            selectable: selectable(s, r),
            ...(!selectable(s, r)
              ? { reason: r.key === 'owner' ? ('owner' as const) : ('authority' as const) }
              : {}),
          }))
        : [],
  };
}
function scopeFor(
  state: RoleSimulationState,
  s: AuthoritySnapshot | undefined,
  profileId: string,
): EffectiveAuthority | undefined {
  if (!state.active || !state.orgId || !state.roleKey) return undefined;
  return {
    profileId,
    orgId: state.orgId,
    roleKey: state.roleKey,
    generation: state.generation,
    rank: state.invalid ? 0 : (s?.catalog.find((r) => r.key === state.roleKey)?.rank ?? 0),
    invalid: state.invalid,
    capabilities: state.invalid
      ? noSimulationCapabilities()
      : buildCapabilities([state.roleKey], s?.rules ?? []),
  };
}
async function auditTransition(
  tx: Tx,
  input: {
    profileId: string;
    orgId: string;
    name: string;
    oldRole: string | null;
    newRole: string | null;
    generation: string;
  },
) {
  await tx`insert into public.doc_audit_log(org_id,ref_type,ref_id,actor_id,actor_name,op,changes,simulation_role_key,simulation_generation)
    values(${input.orgId},'role_simulation',${input.generation}::uuid,${input.profileId}::uuid,${input.name},'simulation',
      ${JSON.stringify([{ field: 'role', old: input.oldRole, new: input.newRole }])}::jsonb,${input.newRole ?? input.oldRole},${input.generation}::uuid)`;
}
/** One request snapshot. Capture it before guards; never leak it into real-member caches. */
export async function admitRoleSimulation(
  event: RequestEvent,
): Promise<EffectiveAuthority | undefined> {
  const { locals } = event;
  locals.roleSimulation = inactiveSimulation();
  if (!locals.user?.supabaseId || !locals.authSessionId) return undefined;
  locals.actualUser = { ...locals.user };
  const identity = actor(locals);
  const orgId = locals.orgId ?? locals.tenantCtx?.tenantId ?? null;
  return getPgClient().begin('isolation level read committed', async (tx) => {
    let row = await readSession(tx, identity.profileId, identity.sessionId);
    // A real organization change retires the old role. No selected role crosses organizations.
    if (row.org_id && orgId && row.org_id !== orgId) {
      const generation = randomUUID();
      const changed = await tx<
        { generation: string }[]
      >`update public.app_role_simulations set role_key=null,generation=${generation}::uuid,
        org_id=${orgId}::uuid,return_to=null,started_at=null,expires_at=null,updated_at=now()
        where session_id=${identity.sessionId}::uuid and profile_id=${identity.profileId}::uuid and generation=${row.generation}::uuid returning generation::text`;
      if (!changed.length) throw new SimulationGenerationConflict(row.generation!);
      await auditTransition(tx, {
        profileId: identity.profileId,
        orgId: row.org_id,
        name: identity.user.displayName ?? identity.user.email,
        oldRole: row.role_key,
        newRole: null,
        generation,
      });
      row = {
        ...row,
        org_id: orgId,
        role_key: null,
        generation,
        return_to: null,
        expires_at: null,
      };
    }
    const finishing =
      event.request.method === 'DELETE' && /\/api\/me\/role-simulation$/.test(event.url.pathname);
    let s: AuthoritySnapshot | undefined;
    try {
      s =
        !finishing && row.role_key && row.org_id
          ? await snapshot(tx, row.org_id, identity.profileId)
          : undefined;
    } catch (cause) {
      if (!isHttpError(cause) || cause.status !== 503) throw cause;
    }
    // An incomplete catalog is a restricted active mode, never actual-admin
    // restoration; the authenticated Finish control needs no role catalog.
    if (orgId && !finishing)
      locals.requestCapabilities = {
        platformAdmin: identity.user.role === 'admin',
        orgId,
        profileId: identity.profileId,
        capabilities: s?.actual ?? (await freshActorCapabilities(tx, orgId, identity.profileId)),
      };
    const state = project(row, orgId, s);
    locals.roleSimulation = state;
    if (state.active) locals.user = { ...identity.user, role: 'user' };
    const scope = scopeFor(state, s, identity.profileId);
    return scope
      ? { ...scope, actorName: identity.user.displayName ?? identity.user.email }
      : undefined;
  });
}
/** Canonical layout/focus catalog; strict SQL errors never produce a partial list. */
export async function loadRoleSimulationState(locals: App.Locals): Promise<RoleSimulationState> {
  if (!locals.user?.supabaseId || !locals.authSessionId) return inactiveSimulation();
  const identity = actor(locals);
  const orgId = locals.orgId ?? locals.tenantCtx?.tenantId ?? null;
  return getPgClient().begin('isolation level read committed read only', async (tx) => {
    const row = await readSession(tx, identity.profileId, identity.sessionId);
    const s = (row.role_key ? row.org_id : orgId)
      ? await snapshot(tx, (row.role_key ? row.org_id : orgId)!, identity.profileId)
      : undefined;
    return project(row, orgId, s);
  });
}
export async function enforceSimulationGeneration(event: RequestEvent): Promise<void> {
  const state = event.locals.roleSimulation;
  if (!state || !event.locals.authSessionId || /^(GET|HEAD|OPTIONS)$/.test(event.request.method))
    return;
  const path = event.url.pathname.replace(/^\/(en|es)(?=\/)/, '');
  if (path === '/api/me/role-simulation' || /^\/api\/(?:auth|dev)(?:\/|$)/.test(path)) return;
  let stamp = event.request.headers.get(SIMULATION_GENERATION_HEADER);
  if (
    !stamp &&
    /^(?:application\/x-www-form-urlencoded|multipart\/form-data)(?:;|$)/i.test(
      event.request.headers.get('content-type') ?? '',
    )
  ) {
    const value = (await event.request.clone().formData()).get('_roleSimulationGeneration');
    if (typeof value === 'string') stamp = value;
  }
  if (
    (!stamp && state.generation === INITIAL_SIMULATION_GENERATION && !state.active) ||
    stamp === state.generation
  )
    return;
  throw new SimulationGenerationConflict(state.generation);
}
export async function roleSimulationLocation(
  locals: App.Locals,
  current: string,
  input?: { original?: string | null; snapshot?: AuthoritySnapshot; selectedRole?: string | null },
): Promise<string> {
  const identity = actor(locals);
  const orgId = locals.orgId ?? locals.tenantCtx?.tenantId;
  if (!orgId) return '/account/home';
  const s =
    input?.snapshot ??
    (await getPgClient().begin('isolation level read committed read only', (tx) =>
      snapshot(tx, orgId, identity.profileId),
    ));
  const role =
    input && 'selectedRole' in input ? input.selectedRole : locals.roleSimulation?.roleKey;
  const capabilities =
    !input && locals.roleSimulation?.invalid
      ? noSimulationCapabilities()
      : role
        ? buildCapabilities([role], s.rules)
        : buildCapabilities(s.actualRoles, s.rules);
  const [moduleStates, entitlements, preferences] = await Promise.all([
    listModuleStates({ db: getCoreDb(), tenantId: orgId, profileId: identity.profileId }),
    resolveEntitlements(orgId),
    getUserPreferences(getCoreDb(), identity.profileId),
  ]);
  return simulationDestination({
    current,
    original: input?.original,
    orgId,
    preferences,
    ctx: {
      nav: s.nav,
      capabilities,
      platformRole: !role && s.platformAdmin ? 'admin' : 'user',
      availability: { kind: locals.orgKind, moduleStates, features: entitlements.features },
    },
  });
}
export async function transitionRoleSimulation(
  locals: App.Locals,
  input: { generation: string; returnTo: string; roleKey?: string },
): Promise<{ location: string; generation: string }> {
  const identity = actor(locals);
  const orgId = locals.orgId ?? locals.tenantCtx?.tenantId;
  const result = await getPgClient().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtextextended(${identity.sessionId},113))`;
    await readSession(tx, identity.profileId, identity.sessionId);
    if (!orgId && input.roleKey) throw error(403, 'Active organization required');
    // Serializes even two simultaneous first Starts; INSERT's unique check waits for its peer.
    if (orgId)
      await tx`insert into public.app_role_simulations(session_id,profile_id,org_id,generation)
      values(${identity.sessionId}::uuid,${identity.profileId}::uuid,${orgId}::uuid,${INITIAL_SIMULATION_GENERATION}::uuid) on conflict do nothing`;
    const rows = await tx<
      SessionRow[]
    >`select session_id::text,profile_id::text,org_id::text,role_key,generation::text,return_to,expires_at
      from public.app_role_simulations where session_id=${identity.sessionId}::uuid and profile_id=${identity.profileId}::uuid for update`;
    const row = rows[0];
    if (!row) throw error(409, 'Simulation already finished');
    if (row.generation !== input.generation)
      throw new SimulationGenerationConflict(row.generation!);
    if (!input.roleKey && !row.role_key) throw error(409, 'Simulation already finished');
    if (input.roleKey && row.role_key && row.org_id !== orgId)
      throw error(409, 'Organization changed. Reload before choosing another role');
    const activeOrg = input.roleKey ? orgId! : row.org_id!;
    const s = input.roleKey ? await snapshot(tx, activeOrg, identity.profileId) : undefined;
    if (input.roleKey) {
      // Replacement never exits selected authority. An expired/revoked mode
      // must be explicitly finished before any new simulation can begin.
      if (row.role_key && project(row, activeOrg, s).invalid)
        throw error(403, 'Finish the unavailable simulation before choosing another role');
      const target = s!.catalog.find((r) => r.key === input.roleKey);
      if (!target || !selectable(s!, target))
        throw error(403, 'This role exceeds your authority or is unavailable');
    }
    const generation = randomUUID();
    const returnTo =
      input.roleKey && !row.role_key ? safeSimulationReturn(input.returnTo) : row.return_to;
    await tx`update public.app_role_simulations set role_key=${input.roleKey ?? null},generation=${generation}::uuid,
      org_id=${activeOrg}::uuid,return_to=${input.roleKey ? returnTo : null},
      started_at=case when ${!input.roleKey} then null when role_key is null then now() else started_at end,
      expires_at=case when ${!input.roleKey} then null when role_key is null then now()+interval '2 hours' else expires_at end,updated_at=now()
      where session_id=${identity.sessionId}::uuid and profile_id=${identity.profileId}::uuid`;
    await auditTransition(tx, {
      profileId: identity.profileId,
      orgId: activeOrg,
      name: identity.user.displayName ?? identity.user.email,
      oldRole: row.role_key,
      newRole: input.roleKey ?? null,
      generation,
    });
    return { s, generation, original: returnTo };
  });
  // Persistence already committed. A fallible refresh must never invite duplicate transition writes.
  let location: string;
  try {
    location = await roleSimulationLocation(locals, input.returnTo, {
      original: result.original,
      snapshot: result.s,
      selectedRole: input.roleKey ?? null,
    });
  } catch {
    location = '/account/home';
  }
  return { location, generation: result.generation };
}
