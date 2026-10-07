import pg17Expected from './catalog-fingerprint.pg17.expected.json';
import pg18Expected from './catalog-fingerprint.pg18.expected.json';

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

type CatalogRecord = Record<string, unknown>;

// Production `pg_roles` for `postgres` (Supabase PG 17.6), probed read-only on 2026-10-07.
const PG17_SESSION_ROLE = Object.freeze({
  rolname: 'postgres',
  rolcanlogin: true,
  rolsuper: false,
  rolinherit: true,
  rolcreaterole: true,
  rolcreatedb: true,
  rolreplication: true,
  rolbypassrls: true,
});

/**
 * Supabase grants its storage service login role SET ROLE into `authenticator`, which is
 * already a member of the three API roles, so `supabase_storage_admin` reaches them two hops
 * away with MEMBER/SET. Migration 20261003170000 admits those six transitive rows only while
 * this exact edge exists; the runtime mirrors that admission rather than freezing the edge.
 */
const PLATFORM_STORAGE_ADMIN_EDGE = Object.freeze({
  target: 'authenticator',
  member: 'supabase_storage_admin',
  grantor: 'supabase_admin',
  admin_option: false,
  inherit_option: false,
  set_option: true,
});

const PG18_SESSION_ROLE = Object.freeze({
  rolcanlogin: true,
  rolsuper: true,
  rolinherit: true,
  rolcreaterole: true,
  rolcreatedb: true,
  rolreplication: true,
  rolbypassrls: true,
});

const SELF_REACHABILITY = Object.freeze(
  ['app_notification_worker', 'notification_event_trigger', 'notification_projection_finalizer']
    .flatMap((role) =>
      ['MEMBER', 'SET', 'USAGE'].map((mode) => ({ mode, source: role, target: role })),
    )
    .sort(compareCatalogRows),
);

function selfReachability(roles: readonly string[]): CatalogRecord[] {
  return roles.flatMap((role) =>
    ['MEMBER', 'SET', 'USAGE'].map((mode) => ({ mode, source: role, target: role })),
  );
}

function isRecord(value: unknown): value is CatalogRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalJson(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (!isRecord(value)) throw new Error('Notification projection catalog is not JSON');
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalJson(entry)]),
  );
}

function exactJson(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
  } catch {
    return false;
  }
}

function compareCatalogRows(left: CatalogRecord, right: CatalogRecord): number {
  return JSON.stringify(canonicalJson(left)).localeCompare(JSON.stringify(canonicalJson(right)));
}

function exactCatalogRows(actual: unknown, expected: readonly CatalogRecord[]): boolean {
  if (!Array.isArray(actual) || actual.some((row) => !isRecord(row))) return false;
  return exactJson([...actual].sort(compareCatalogRows), [...expected].sort(compareCatalogRows));
}

function expectedOwnerEdges(serverMajor: number, sessionUser: string): CatalogRecord[] {
  if (serverMajor === 17) {
    return [
      {
        member: 'postgres',
        target: 'app_notification_worker',
        grantor: 'postgres',
        set_option: true,
        admin_option: false,
        inherit_option: true,
      },
      {
        member: 'postgres',
        target: 'app_notification_worker',
        grantor: 'supabase_admin',
        set_option: false,
        admin_option: true,
        inherit_option: false,
      },
      {
        member: 'postgres',
        target: 'notification_event_trigger',
        grantor: 'supabase_admin',
        set_option: false,
        admin_option: true,
        inherit_option: false,
      },
      {
        member: 'postgres',
        target: 'notification_projection_finalizer',
        grantor: 'supabase_admin',
        set_option: false,
        admin_option: true,
        inherit_option: false,
      },
    ].sort(compareCatalogRows);
  }
  return [
    {
      member: sessionUser,
      target: 'app_notification_worker',
      grantor: sessionUser,
      set_option: true,
      admin_option: false,
      inherit_option: true,
    },
  ];
}

function expectedReachability(serverMajor: number): CatalogRecord[] {
  if (serverMajor === 18) return [...SELF_REACHABILITY];
  return [
    ...SELF_REACHABILITY,
    { mode: 'MEMBER', source: 'postgres', target: 'app_notification_worker' },
    { mode: 'SET', source: 'postgres', target: 'app_notification_worker' },
    { mode: 'USAGE', source: 'postgres', target: 'app_notification_worker' },
    { mode: 'MEMBER', source: 'postgres', target: 'notification_event_trigger' },
    { mode: 'MEMBER', source: 'postgres', target: 'notification_projection_finalizer' },
  ].sort(compareCatalogRows);
}

function expectedSourceOwnerEdgeVariants(
  serverMajor: number,
  sessionUser: string,
): CatalogRecord[][] {
  if (serverMajor === 18) {
    const appWorkerEdge = {
      member: sessionUser,
      target: 'app_notification_worker',
      grantor: sessionUser,
      set_option: true,
      admin_option: false,
      inherit_option: true,
    };
    return [
      [appWorkerEdge],
      [
        appWorkerEdge,
        {
          member: sessionUser,
          target: 'app_ledger',
          grantor: sessionUser,
          set_option: true,
          admin_option: false,
          inherit_option: true,
        },
      ],
    ];
  }
  return [
    [
      ...['anon', 'authenticated', 'service_role'].flatMap((target) => [
        {
          member: 'authenticator',
          target,
          grantor: 'supabase_admin',
          set_option: true,
          admin_option: false,
          inherit_option: false,
        },
        {
          member: 'postgres',
          target,
          grantor: 'supabase_admin',
          set_option: true,
          admin_option: true,
          inherit_option: true,
        },
      ]),
      ...['app_ledger', 'app_notification_worker'].flatMap((target) => [
        {
          member: 'postgres',
          target,
          grantor: 'postgres',
          set_option: true,
          admin_option: false,
          inherit_option: true,
        },
        {
          member: 'postgres',
          target,
          grantor: 'supabase_admin',
          set_option: false,
          admin_option: true,
          inherit_option: false,
        },
      ]),
    ],
  ];
}

function hasPlatformStorageAdminEdge(platformEdges: unknown): boolean {
  return (
    Array.isArray(platformEdges) &&
    platformEdges.some((edge) => exactJson(edge, PLATFORM_STORAGE_ADMIN_EDGE))
  );
}

function expectedSourceReachability(serverMajor: number, platformEdges: unknown): CatalogRecord[] {
  if (serverMajor === 18) {
    return selfReachability([
      'anon',
      'app_ledger',
      'app_notification_worker',
      'authenticated',
      'service_role',
    ]);
  }
  return [
    ...selfReachability([
      'anon',
      'app_ledger',
      'app_notification_worker',
      'authenticated',
      'postgres',
      'service_role',
    ]),
    ...['anon', 'authenticated', 'service_role'].flatMap((target) =>
      ['MEMBER', 'SET'].map((mode) => ({ mode, source: 'authenticator', target })),
    ),
    ...(hasPlatformStorageAdminEdge(platformEdges)
      ? ['anon', 'authenticated', 'service_role'].flatMap((target) =>
          ['MEMBER', 'SET'].map((mode) => ({ mode, source: 'supabase_storage_admin', target })),
        )
      : []),
    ...['anon', 'app_ledger', 'app_notification_worker', 'authenticated', 'service_role'].flatMap(
      (target) => ['MEMBER', 'SET', 'USAGE'].map((mode) => ({ mode, source: 'postgres', target })),
    ),
  ];
}

function normalizeCommonCatalog(
  snapshot: CatalogRecord,
  sessionUser: string,
): CatalogRecord | null {
  const sourceRelations = snapshot.sourceRelations;
  const operationalRelations = snapshot.operationalRelations;
  if (!Array.isArray(sourceRelations) || !Array.isArray(operationalRelations)) return null;
  const normalizedRelations: CatalogRecord[] = [];
  for (const relation of sourceRelations) {
    if (!isRecord(relation) || relation.owner !== sessionUser) return null;
    normalizedRelations.push({ ...relation, owner: 'RELATION_OWNER' });
  }
  const normalizedOperationalRelations: CatalogRecord[] = [];
  for (const relation of operationalRelations) {
    if (!isRecord(relation) || relation.owner !== sessionUser) return null;
    normalizedOperationalRelations.push({ ...relation, owner: 'RELATION_OWNER' });
  }
  const {
    serverMajor: _serverMajor,
    sessionUser: _sessionUser,
    sessionRole: _sessionRole,
    sourceOwnerEdges: _sourceOwnerEdges,
    sourceReachability: _sourceReachability,
    platformEdges: _platformEdges,
    ownerEdges: _ownerEdges,
    reachability: _reachability,
    ...common
  } = snapshot;
  return {
    ...common,
    sourceRelations: normalizedRelations,
    operationalRelations: normalizedOperationalRelations,
  };
}

/**
 * Compares every reviewed catalog field. The expected JSON is deliberately
 * machine-readable source data; a digest alone could hide which authority row
 * drifted and would turn admission into an unverifiable all-or-nothing check.
 */
export function notificationProjectionCatalogMatches(snapshot: unknown): boolean {
  if (!isRecord(snapshot)) return false;
  const serverMajor = snapshot.serverMajor;
  const sessionUser = snapshot.sessionUser;
  if ((serverMajor !== 17 && serverMajor !== 18) || typeof sessionUser !== 'string') return false;

  const expectedRole =
    serverMajor === 17 ? PG17_SESSION_ROLE : { ...PG18_SESSION_ROLE, rolname: sessionUser };
  if (!exactJson(snapshot.sessionRole, expectedRole)) return false;
  if (
    !expectedSourceOwnerEdgeVariants(serverMajor, sessionUser).some((expected) =>
      exactCatalogRows(snapshot.sourceOwnerEdges, expected),
    )
  )
    return false;
  if (
    !exactCatalogRows(
      snapshot.sourceReachability,
      expectedSourceReachability(serverMajor, snapshot.platformEdges),
    )
  )
    return false;
  if (!exactCatalogRows(snapshot.ownerEdges, expectedOwnerEdges(serverMajor, sessionUser)))
    return false;
  if (!exactCatalogRows(snapshot.reachability, expectedReachability(serverMajor))) return false;

  const common = normalizeCommonCatalog(snapshot, sessionUser);
  if (common === null) return false;
  return exactJson(common, serverMajor === 17 ? pg17Expected : pg18Expected);
}
