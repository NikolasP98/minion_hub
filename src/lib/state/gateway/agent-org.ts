/**
 * Org-scoping for the live gateway agent list.
 *
 * The gateway is a single shared server with no per-org concept — it streams the
 * full agent roster to every connected client over the WebSocket. Org visibility
 * is therefore applied client-side (the same place the per-user `allowedAgentIds`
 * filter lives), keyed off the active organization from `page.data`.
 *
 * Assignment rule: agents whose name (or id) contains "faces" belong to the
 * FACES SCULPTORS org; every other agent belongs to the MINION org. Org ids are
 * resolved dynamically by slug from the user's organization list — never
 * hardcoded — so this keeps working if the underlying UUIDs change.
 *
 * Provisioned brain agents (`brain-<brainUuid>`) don't have org-shaped names,
 * so they opt out of the name rule entirely: `filterAgentsByOrg`'s
 * `orgAgentIds` param carries their real org assignment (from `brains.org_id`
 * via `listBrainAgentIds`), and any `brain-*` id NOT in that set is hidden
 * rather than defaulting to MINION.
 */
import { PUBLIC_DEFAULT_ORG_SLUG } from '$env/static/public';

/** Org slugs (stable) used to map the name rule onto concrete org ids. */
export const FACES_ORG_SLUG = PUBLIC_DEFAULT_ORG_SLUG || 'faces-sculptors';
export const MINION_ORG_SLUG = 'minion';

// Derived from the slug's first hyphen-separated segment so the default slug
// ('faces-sculptors') reproduces the original hardcoded /faces/i behavior
// (bare "faces" substring, case-insensitive) in agent name/id.
const FACES_RE = new RegExp(FACES_ORG_SLUG.split('-')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

/** A minimal org shape — the subset of `page.data.organizations` we need. */
export interface OrgRef {
  id: string;
  slug: string | null;
}

/** The minimal agent shape the name rule inspects. */
export interface AgentLike {
  id: string;
  name?: string | null;
}

/** True when the agent belongs to the FACES org by the name rule. */
export function isFacesAgent(agent: AgentLike): boolean {
  return FACES_RE.test(agent.name ?? '') || FACES_RE.test(agent.id);
}

/** True when the id looks like a provisioned brain agent (`brain-<brainUuid>`,
 *  see `deriveBrainAgentId` in `brain-agents.service.ts`). These are assigned
 *  to orgs explicitly (via `orgAgentIds`), never by the name rule — an
 *  unassigned one must not fall through to the "faces substring → FACES,
 *  else MINION" default, or it leaks into whichever org that default lands on. */
const BRAIN_AGENT_RE = /^brain-/;

/**
 * Filter the gateway agent list down to those visible in the active org.
 *
 * Defensive by design: if the active org is unknown, the org list is empty, or
 * the active org is neither FACES nor MINION, the list is returned unfiltered so
 * a config/slug drift can never silently blank the roster.
 *
 * `orgAgentIds` — agent ids explicitly known to belong to the ACTIVE org
 * (e.g. brain agents, loaded org-scoped in `+layout.server.ts` via
 * `listBrainAgentIds`). Membership there always wins over the name rule.
 * A `brain-*` id NOT in the set is hidden from both mapped orgs — it belongs
 * to some other org, so the name rule's "else → MINION" default would
 * otherwise leak it into MINION's roster.
 */
export function filterAgentsByOrg<T extends AgentLike>(
  list: T[],
  activeOrgId: string | null | undefined,
  orgs: OrgRef[],
  orgAgentIds?: ReadonlySet<string> | string[],
): T[] {
  if (!activeOrgId || orgs.length === 0) return list;

  const facesOrgId = orgs.find((o) => o.slug === FACES_ORG_SLUG)?.id ?? null;
  const minionOrgId = orgs.find((o) => o.slug === MINION_ORG_SLUG)?.id ?? null;

  // Only scope when the active org is one of the two we map onto.
  if (activeOrgId !== facesOrgId && activeOrgId !== minionOrgId) return list;

  const activeOrgAgentIds =
    orgAgentIds instanceof Set ? orgAgentIds : new Set(orgAgentIds ?? []);

  return list.filter((a) => {
    if (activeOrgAgentIds.has(a.id)) return true;
    if (BRAIN_AGENT_RE.test(a.id)) return false;
    const agentOrgId = isFacesAgent(a) ? facesOrgId : minionOrgId;
    return agentOrgId === activeOrgId;
  });
}
