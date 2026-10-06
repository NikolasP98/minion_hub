import { createHash } from 'node:crypto';
import { canonicalNotificationPayload, utf8Bytes } from '$lib/notifications/canonical';
import { buildCapabilities, resolveMemberRoleKeys } from '../../rbac.service';
import { PROJECTION_LIMITS, type AudienceMode } from './contracts';

export type AuthorityMemberRow = Readonly<{
  profileId: string;
  legacyRole: string | null;
  profileRole: string | null;
  roleKey: string | null;
}>;

export type AuthorityRuleRow = Readonly<{
  role_key: string;
  module: 'users';
  can_manage: boolean;
  if_owner: boolean;
  field_level: number;
}>;

export type AuthorizedRecipient = Readonly<{
  profileId: string;
  audienceMode: AudienceMode;
  evidence: string;
}>;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function evidenceBytes(input: unknown): { canonical: string; bytes: number } {
  const canonical = canonicalNotificationPayload(input);
  return { canonical, bytes: utf8Bytes(canonical) };
}

/** Mirrors current buildCapabilities semantics after SQL performs the role-first bounded seek. */
export function resolveManagerRecipients(
  rows: readonly AuthorityMemberRow[],
  rules: readonly AuthorityRuleRow[],
): readonly AuthorizedRecipient[] {
  const roleKeys = new Set(rows.flatMap((row) => (row.roleKey ? [row.roleKey] : [])));
  for (const row of rows) {
    if (!row.roleKey) roleKeys.add(resolveMemberRoleKeys([], row.legacyRole)[0]!);
  }
  if (roleKeys.size > PROJECTION_LIMITS.roleKeys || rules.length > PROJECTION_LIMITS.rules)
    throw new RangeError('notification_authority_overflow');

  const members = new Map<
    string,
    { legacyRole: string | null; profileRole: string | null; roles: Set<string> }
  >();
  let assignments = 0;
  for (const row of rows) {
    const member = members.get(row.profileId) ?? {
      legacyRole: row.legacyRole,
      profileRole: row.profileRole,
      roles: new Set<string>(),
    };
    if (row.roleKey) {
      member.roles.add(row.roleKey);
      assignments++;
      if (member.roles.size > PROJECTION_LIMITS.rolesPerRecipient)
        throw new RangeError('notification_authority_overflow');
    }
    members.set(row.profileId, member);
  }
  if (assignments > PROJECTION_LIMITS.assignments)
    throw new RangeError('notification_authority_overflow');

  const sortedRules = [...rules].sort((left, right) =>
    left.role_key.localeCompare(right.role_key, 'en-US'),
  );
  let totalBytes = 0;
  const groups = new Set<string>();
  const recipients: AuthorizedRecipient[] = [];
  for (const [profileId, member] of [...members].sort(([left], [right]) =>
    left.localeCompare(right, 'en-US'),
  )) {
    const roles = resolveMemberRoleKeys([...member.roles].sort(), member.legacyRole);
    const roleSet = new Set(roles);
    const relevantRules = sortedRules.filter((rule) => roleSet.has(rule.role_key));
    const admitted =
      member.profileRole === 'admin' ||
      buildCapabilities(
        roles,
        relevantRules.map((rule) => ({
          ...rule,
          can_view: false,
          can_create: false,
          can_edit: false,
          can_delete: false,
          can_export: false,
        })),
      ).can('users', 'manage');
    if (!admitted) continue;
    const authority = evidenceBytes({
      legacyRole: member.legacyRole,
      profileAdmin: member.profileRole === 'admin',
      roles,
      rules: relevantRules.map((rule) => ({
        canManage: rule.can_manage,
        fieldLevel: rule.field_level ?? 0,
        ifOwner: rule.if_owner ?? false,
        roleKey: rule.role_key,
      })),
    });
    if (authority.bytes > PROJECTION_LIMITS.authorityGroupBytes)
      throw new RangeError('notification_authority_overflow');
    totalBytes += authority.bytes;
    groups.add(sha256(authority.canonical));
    recipients.push(
      Object.freeze({ profileId, audienceMode: 'users_manage', evidence: authority.canonical }),
    );
  }
  if (
    groups.size > PROJECTION_LIMITS.authorityGroups ||
    totalBytes > PROJECTION_LIMITS.authorityBundleBytes
  ) {
    throw new RangeError('notification_authority_overflow');
  }
  return Object.freeze(recipients);
}

export function authorityDigest(input: unknown): string {
  return sha256(canonicalNotificationPayload(input));
}
