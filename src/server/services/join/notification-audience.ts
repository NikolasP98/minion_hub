import {
  resolveFreshOrgMemberWithCapability,
  resolveFreshOrgMembersWithCapability,
  type FreshOrgAuthorizedMember,
} from '../fresh-org-authority';

export interface JoinReviewRecipient {
  profileId: string;
  email: string;
}

export interface JoinReviewAuthority {
  resolveMembers(
    organizationId: string,
    module: 'users',
    action: 'manage',
  ): Promise<FreshOrgAuthorizedMember[]>;
  resolveMember(
    organizationId: string,
    profileId: string,
    module: 'users',
    action: 'manage',
  ): Promise<FreshOrgAuthorizedMember | null>;
}

const DEFAULT_JOIN_REVIEW_AUTHORITY: JoinReviewAuthority = {
  resolveMembers: resolveFreshOrgMembersWithCapability,
  resolveMember: resolveFreshOrgMemberWithCapability,
};

/** Resolve and deduplicate the complete audience before the first provider call. */
export async function prepareJoinReviewRecipients(
  organizationId: string,
  authority: JoinReviewAuthority = DEFAULT_JOIN_REVIEW_AUTHORITY,
): Promise<JoinReviewRecipient[]> {
  const authorized = await authority.resolveMembers(organizationId, 'users', 'manage');
  const byEmail = new Map<string, JoinReviewRecipient>();
  for (const member of authorized) {
    if (!member.verifiedEmail || byEmail.has(member.verifiedEmail)) continue;
    byEmail.set(member.verifiedEmail, {
      profileId: member.profileId,
      email: member.verifiedEmail,
    });
  }
  return [...byEmail.values()];
}

/** Final admission check; a changed address is suppressed instead of substituted. */
export async function recheckJoinReviewRecipient(
  organizationId: string,
  candidate: JoinReviewRecipient,
  authority: JoinReviewAuthority = DEFAULT_JOIN_REVIEW_AUTHORITY,
): Promise<boolean> {
  const current = await authority.resolveMember(
    organizationId,
    candidate.profileId,
    'users',
    'manage',
  );
  return current?.verifiedEmail === candidate.email;
}
