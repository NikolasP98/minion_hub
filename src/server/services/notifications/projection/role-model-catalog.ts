/** Exact additive catalog contract introduced by migration 20261112020000.
 * Derive the extension from the already reviewed base rather than accepting an
 * arbitrary new source relation, worker grant or policy through normalization.
 */
type Row = Record<string, unknown>;
export function withOrganizationRoleSources(
  base: Record<string, unknown>,
  enabled = true,
): Record<string, unknown> {
  const rows = (key: string) => (base[key] as Row[]).map((row) => ({ ...row }));
  const ordered = (list: Row[], keys: string[]) =>
    list.sort((a, b) => {
      for (const key of keys) {
        const left = String(a[key]),
          right = String(b[key]);
        const v = left < right ? -1 : left > right ? 1 : 0;
        if (v) return v;
      }
      return 0;
    });
  const sourceRelations = rows('sourceRelations');
  sourceRelations.push({
    owner: 'RELATION_OWNER',
    relname: 'org_roles',
    relrowsecurity: true,
    relforcerowsecurity: true,
  });
  const tableAcl = rows('tableAcl');
  tableAcl.push(
    ...tableAcl
      .filter((r) => r.relname === 'permission_rules')
      .map((r) => ({ ...r, relname: 'org_roles' })),
  );
  const columnAcl = rows('columnAcl');
  for (const [relname, attname] of enabled
    ? [
        ['organizations', 'role_model'],
        ['org_roles', 'org_id'],
        ['org_roles', 'key'],
      ]
    : []) {
    columnAcl.push({
      attname,
      grantee: 'app_notification_worker',
      grantor: 'RELATION_OWNER',
      relname,
      is_grantable: false,
      privilege_type: 'SELECT',
    });
  }
  const sourcePolicies = rows('sourcePolicies');
  const legacyQual = "org_id = current_setting('app.current_org_id'::text, true)";
  sourcePolicies.push({
    qual: legacyQual,
    roles: ['PUBLIC'],
    polcmd: '*',
    polname: 'org_roles_org_guc',
    relname: 'org_roles',
    with_check: legacyQual,
    polpermissive: true,
  });
  const existingFence = sourcePolicies.find(
    (r) =>
      r.relname === 'permission_rules' &&
      r.polname === 'notification_projection_permission_rules_select',
  );
  if (!existingFence || typeof existingFence.qual !== 'string')
    throw Error('Reviewed notification fence missing');
  const fenceQual = existingFence.qual
    .replace('org_id::text =', 'org_id =')
    .replace(" AND module = 'users'::text", '');
  if (enabled)
    sourcePolicies.push({
      qual: fenceQual,
      roles: ['app_notification_worker'],
      polcmd: 'r',
      polname: 'notification_projection_org_roles_fence',
      relname: 'org_roles',
      with_check: null,
      polpermissive: false,
    });
  return {
    ...base,
    sourceRelations: ordered(sourceRelations, ['relname']),
    tableAcl: ordered(tableAcl, ['relname', 'grantee', 'grantor', 'is_grantable']),
    columnAcl: ordered(columnAcl, ['relname', 'attname', 'grantee', 'grantor', 'privilege_type']),
    sourcePolicies: ordered(sourcePolicies, ['relname', 'polname']),
  };
}
