export interface CapturedCatalog {
  relations: {
    relname: string;
    owner: string;
    acl: string | null;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
  }[];
  columns: {
    relname: string;
    attname: string;
    type: string;
    attnotnull: boolean;
    attidentity: string;
    attgenerated: string;
    default_expression: string | null;
  }[];
  constraints: { relname: string; conname: string; contype: string; definition: string }[];
  indexes: { relname: string; indexname: string; definition: string }[];
  policies: {
    tablename: string;
    policyname: string;
    permissive: string;
    roles: string[];
    cmd: string;
    qual: string | null;
    with_check: string | null;
  }[];
  triggers: { relname: string; tgname: string; tgenabled: string; definition: string }[];
  admittedFunctionBodies?: {
    schema: string;
    function: string;
    definition: string;
    acl: string | null;
  }[];
}
export const quoteCatalogIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
const mappedRole = (role: string) => (role === 'postgres' ? 'minion_qc' : role);
const aclPrivileges: Record<string, string> = {
  a: 'INSERT',
  r: 'SELECT',
  w: 'UPDATE',
  d: 'DELETE',
  D: 'TRUNCATE',
  x: 'REFERENCES',
  t: 'TRIGGER',
  m: 'MAINTAIN',
  X: 'EXECUTE',
};
/** Exact captured privilege letters, including grant options; never blanket CRUD. */
function grants(kind: 'TABLE' | 'FUNCTION', target: string, acl: string | null) {
  const statements = [`REVOKE ALL ON ${kind} ${target} FROM PUBLIC;`];
  if (acl === null) throw new Error(`Uncaptured ACL for ${target}`);
  for (const entry of acl.slice(1, -1).split(',')) {
    const match = /^([^=]*)=([^/]*)\/([^/]+)$/.exec(entry);
    if (!match) throw new Error('Unexpected catalog ACL format');
    const role = match[1] ? quoteCatalogIdentifier(mappedRole(match[1])) : 'PUBLIC';
    for (const permission of match[2].matchAll(/([arwdDxtmX])(\*)?/g)) {
      statements.push(
        `GRANT ${aclPrivileges[permission[1]]} ON ${kind} ${target} TO ${role}${permission[2] ? ' WITH GRANT OPTION' : ''};`,
      );
    }
  }
  return statements;
}
/** Only namespace/owner mapping changes. Every physical column, generated expression,
 * constraint, index, policy, table ACL and admitted function/trigger is retained.
 * Provider identity/session issuance is outside this disposable-domain qualification. */
export function capturedPostgresDdl(
  schema: string,
  authSchema: string,
  domain: CapturedCatalog,
  auth: CapturedCatalog,
) {
  if (!/^qc_job_stock_[a-f0-9]{32}$/.test(schema) || authSchema !== `${schema}_auth`)
    throw new Error('Invalid fixture namespaces');
  const map = (sql: string) =>
    sql
      .replaceAll('public.', `${quoteCatalogIdentifier(schema)}.`)
      .replaceAll('auth.', `${quoteCatalogIdentifier(authSchema)}.`)
      .replaceAll(
        "SET search_path TO 'public'",
        `SET search_path TO ${quoteCatalogIdentifier(schema)}`,
      );
  const sources = [
    { schema: authSchema, catalog: auth },
    { schema, catalog: domain },
  ];
  const statements = [
    `CREATE SCHEMA ${quoteCatalogIdentifier(schema)}; CREATE SCHEMA ${quoteCatalogIdentifier(authSchema)}; SET search_path TO ${quoteCatalogIdentifier(schema)},pg_catalog;`,
  ];
  const roles = new Set<string>();
  for (const { catalog } of sources)
    for (const relation of catalog.relations) {
      roles.add(mappedRole(relation.owner));
      for (const entry of relation.acl?.slice(1, -1).split(',') ?? []) {
        const role = entry.split('=')[0];
        if (role) roles.add(mappedRole(role));
      }
    }
  for (const fn of domain.admittedFunctionBodies ?? [])
    for (const entry of fn.acl?.slice(1, -1).split(',') ?? []) {
      const role = entry.split('=')[0];
      if (role) roles.add(mappedRole(role));
    }
  for (const role of roles) {
    if (role !== 'minion_qc')
      statements.push(
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN CREATE ROLE ${quoteCatalogIdentifier(role)} NOLOGIN NOBYPASSRLS; END IF; END $$;`,
      );
    statements.push(
      `GRANT USAGE ON SCHEMA ${quoteCatalogIdentifier(schema)},${quoteCatalogIdentifier(authSchema)} TO ${quoteCatalogIdentifier(role)};`,
    );
  }
  // Guard the application role independently of table FORCE RLS.
  statements.push(
    `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_ledger' AND (rolsuper OR rolbypassrls)) THEN RAISE EXCEPTION 'Unsafe fixture app_ledger role'; END IF; END $$;`,
  );
  for (const { schema: target, catalog } of sources)
    for (const relation of catalog.relations) {
      const columns = catalog.columns
        .filter((c) => c.relname === relation.relname)
        .map((c) => {
          if (c.attidentity) throw new Error('Unqualified identity sequence in captured fixture');
          const expression = c.attgenerated
            ? ` GENERATED ALWAYS AS (${c.default_expression}) ${c.attgenerated === 's' ? 'STORED' : 'VIRTUAL'}`
            : c.default_expression !== null
              ? ` DEFAULT ${c.default_expression}`
              : '';
          return map(
            `${quoteCatalogIdentifier(c.attname)} ${c.type}${expression}${c.attnotnull ? ' NOT NULL' : ''}`,
          );
        });
      statements.push(
        `CREATE TABLE ${quoteCatalogIdentifier(target)}.${quoteCatalogIdentifier(relation.relname)} (${columns.join(',')});`,
      );
    }
  for (const fn of domain.admittedFunctionBodies ?? []) {
    statements.push(map(`${fn.definition.trimEnd()};`));
    const target = fn.function.includes('.')
      ? map(fn.function)
      : `${quoteCatalogIdentifier(schema)}.${fn.function}`;
    const owner = fn.schema === 'auth' ? 'supabase_auth_admin' : 'minion_qc';
    statements.push(
      `ALTER FUNCTION ${target} OWNER TO ${quoteCatalogIdentifier(owner)};`,
      ...grants('FUNCTION', target, fn.acl),
    );
  }
  // All tables exist before FK constraints; primary/unique constraints precede FKs.
  for (const foreign of [false, true])
    for (const { schema: target, catalog } of sources)
      for (const c of catalog.constraints) {
        if ((c.contype === 'f') !== foreign) continue;
        statements.push(
          map(
            `ALTER TABLE ${quoteCatalogIdentifier(target)}.${quoteCatalogIdentifier(c.relname)} ADD CONSTRAINT ${quoteCatalogIdentifier(c.conname)} ${c.definition};`,
          ),
        );
      }
  for (const { catalog } of sources)
    for (const index of catalog.indexes) {
      if (
        catalog.constraints.some(
          (c) => c.conname === index.indexname && c.relname === index.relname,
        )
      )
        continue;
      statements.push(map(`${index.definition};`));
    }

  for (const { schema: target, catalog } of sources) {
    for (const policy of catalog.policies)
      statements.push(
        map(
          `CREATE POLICY ${quoteCatalogIdentifier(policy.policyname)} ON ${quoteCatalogIdentifier(target)}.${quoteCatalogIdentifier(policy.tablename)} AS ${policy.permissive} FOR ${policy.cmd} TO ${policy.roles.map((r) => (r === 'public' ? 'PUBLIC' : quoteCatalogIdentifier(mappedRole(r)))).join(',')}${policy.qual ? ` USING (${policy.qual})` : ''}${policy.with_check ? ` WITH CHECK (${policy.with_check})` : ''};`,
        ),
      );
    for (const relation of catalog.relations) {
      const table = `${quoteCatalogIdentifier(target)}.${quoteCatalogIdentifier(relation.relname)}`;
      statements.push(
        `ALTER TABLE ${table} OWNER TO ${quoteCatalogIdentifier(mappedRole(relation.owner))};`,
        ...grants('TABLE', table, relation.acl),
      );
      if (relation.relrowsecurity)
        statements.push(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`);
      if (relation.relforcerowsecurity)
        statements.push(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`);
    }
    for (const trigger of catalog.triggers) {
      statements.push(map(`${trigger.definition};`));
      const action = (
        { O: 'ENABLE', D: 'DISABLE', R: 'ENABLE REPLICA', A: 'ENABLE ALWAYS' } as Record<
          string,
          string
        >
      )[trigger.tgenabled];
      if (!action) throw new Error('Unrecognized trigger enable state');
      statements.push(
        `ALTER TABLE ${quoteCatalogIdentifier(target)}.${quoteCatalogIdentifier(trigger.relname)} ${action} TRIGGER ${quoteCatalogIdentifier(trigger.tgname)};`,
      );
    }
  }
  return statements.join('\n');
}

function stableCatalogValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableCatalogValue).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableCatalogValue(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
/** Combining fixtures cannot silently replace an overlapping physical definition. */
export function mergeCapturedCatalogs(...catalogs: CapturedCatalog[]): CapturedCatalog {
  function merge<K extends keyof CapturedCatalog>(
    key: K,
    identity: (row: NonNullable<CapturedCatalog[K]>[number]) => string,
  ): NonNullable<CapturedCatalog[K]> {
    const rows = new Map<string, NonNullable<CapturedCatalog[K]>[number]>();
    for (const catalog of catalogs)
      for (const row of catalog[key] ?? []) {
        const id = identity(row);
        const existing = rows.get(id);
        if (existing && stableCatalogValue(existing) !== stableCatalogValue(row))
          throw new Error(`Conflicting captured ${key}: ${id}`);
        rows.set(id, row);
      }
    return [...rows.values()] as NonNullable<CapturedCatalog[K]>;
  }
  return {
    relations: merge('relations', (r) => r.relname),
    columns: merge('columns', (r) => `${r.relname}.${r.attname}`),
    constraints: merge('constraints', (r) => `${r.relname}.${r.conname}`),
    indexes: merge('indexes', (r) => `${r.relname}.${r.indexname}`),
    policies: merge('policies', (r) => `${r.tablename}.${r.policyname}`),
    triggers: merge('triggers', (r) => `${r.relname}.${r.tgname}`),
    admittedFunctionBodies: merge('admittedFunctionBodies', (r) => `${r.schema}.${r.function}`),
  };
}
