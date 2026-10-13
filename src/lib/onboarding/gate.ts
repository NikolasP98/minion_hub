/**
 * First-run setup gate — pure logic, shared by the `(app)` layout guard and the
 * `/onboarding` page load so they can never disagree.
 *
 * Two independent, non-exclusive flows, each with its own nullable marker:
 *  - `org`  — `organizations.onboarded_at`: org kind + business timezone and
 *             currency. Only an owner/admin of that org can set them, so a
 *             plain member is never held at a form they cannot submit.
 *  - `user` — `profiles.onboarded_at`: display name + UI language.
 *
 * When both apply the org flow runs first (owner ask 2026-10-12: "new user
 * runs right after new-org on first-runs").
 */
export type OnboardingScope = 'org' | 'user';

/** The slice of an `OrganizationEntry` this decision needs. */
export interface OnboardingOrg {
  onboardedAt: string | null;
  /** The viewer's role WITHIN this org (`organization_members.role`). */
  role: string;
}

export interface OnboardingInput {
  userOnboardedAt: string | null;
  activeOrg: OnboardingOrg | null;
}

/** Roles allowed to run the org flow — they own `settings: manage`. */
const ORG_SETUP_ROLES = new Set(['owner', 'admin']);

export function pendingOnboardingScopes(input: OnboardingInput): OnboardingScope[] {
  const scopes: OnboardingScope[] = [];
  const org = input.activeOrg;
  if (org && !org.onboardedAt && ORG_SETUP_ROLES.has(org.role)) scopes.push('org');
  if (!input.userOnboardedAt) scopes.push('user');
  return scopes;
}

/** The scope to render next, or null when there is nothing left to set up. */
export function nextOnboardingScope(input: OnboardingInput): OnboardingScope | null {
  return pendingOnboardingScopes(input)[0] ?? null;
}

export function requiresOnboarding(input: OnboardingInput): boolean {
  return pendingOnboardingScopes(input).length > 0;
}
