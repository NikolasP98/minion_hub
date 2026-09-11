import { error } from '@sveltejs/kit';
import { and, eq, or, sql } from 'drizzle-orm';
import { gateway, personalAgents } from '@minion-stack/db/pg';
import { supabaseAdmin } from '$server/supabase';
import { getCoreDb } from '$server/db/pg-client';
import { brains } from '$server/db/pg-schema/brains';
import { resolveCapabilities, type Capabilities } from '$server/services/rbac.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BRAIN_AGENT_RE = /^brain-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export interface AssistantPrincipal {
  /** Owning profile UUID, or the managing brain agent id for brain capabilities. */
  principalId: string;
  /** Authorized organization; gateway callers must also be assigned to it. */
  orgId: string;
  role: string | null;
  capabilities: Capabilities;
}

function rejectAssistant(status: 400 | 401 | 403 | 503, code: string, message: string): never {
  const body = { code, message };
  throw error(status, body);
}

/** Identity lookup failures never grant authority or expose backend error details. */
async function readIdentity<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    rejectAssistant(
      503,
      'ASSISTANT_IDENTITY_UNAVAILABLE',
      'Assistant identity is temporarily unavailable.',
    );
  }
}

function brainAgentCapabilities(): Capabilities {
  return {
    roles: [],
    can: (module, action) => module === 'brains' && (action === 'view' || action === 'edit'),
    canRunAnalytics: () => false,
    visibleModules: () => ['brains'],
    ownerScoped: () => false,
    fieldLevel: () => 0,
  };
}

async function resolveBrainAgentPrincipal(
  locals: App.Locals,
  agentId: string,
  requestedOrg: string | null,
): Promise<AssistantPrincipal> {
  if (!locals.user) throw error(401, 'Authentication required');
  if (locals.user.role !== 'admin' && locals.user.supabaseId !== agentId)
    throw error(403, 'forbidden');

  const rows = await readIdentity(() =>
    getCoreDb()
      .select({ orgId: brains.orgId })
      .from(brains)
      .where(eq(brains.agentId, agentId))
      .limit(2),
  );
  if (rows.length !== 1) throw error(400, 'unresolvable principal');
  const row = rows[0];
  if (requestedOrg && requestedOrg !== row.orgId) {
    rejectAssistant(
      403,
      'ASSISTANT_ORG_NOT_ASSIGNED',
      'The assistant is not assigned to the requested organization.',
    );
  }
  return {
    principalId: agentId,
    orgId: row.orgId,
    role: 'agent',
    capabilities: brainAgentCapabilities(),
  };
}

/**
 * A personal_agents row is the persisted agent/owner/gateway assignment written
 * by provisionPersonalAgent. Read the current gateway row on every request:
 * cached server-id or token resolution is not evidence of a current org lease.
 * The comparison uses equality, never ILIKE wildcards, for legacy agent ids.
 */
async function resolveGatewayPrincipal(
  locals: App.Locals,
  agentId: string | null,
  userId: string | null,
  requestedOrg: string | null,
): Promise<AssistantPrincipal> {
  const serverId = locals.serverId;
  const tokenOrg = locals.tenantCtx?.tenantId;
  if (!serverId || !tokenOrg || !agentId || userId) {
    rejectAssistant(
      403,
      'ASSISTANT_GATEWAY_ASSIGNMENT_REQUIRED',
      'A current gateway assignment for this assistant is required.',
    );
  }
  if (BRAIN_AGENT_RE.test(agentId)) {
    // TODO(handoff): Persist and verify a brain-agent/gateway/org assignment before restoring gateway brain calls; brain_access alone does not bind a gateway. See meta proposals/2026-09-09-assistant-query-delegation-restoration.md (SEC-06 / Phase 15).
    rejectAssistant(
      403,
      'ASSISTANT_BRAIN_ASSIGNMENT_REQUIRED',
      'A verified gateway assignment for this brain assistant is required.',
    );
  }

  // legacy_server_id is not unique in the current schema. Resolve it before
  // looking at the requested agent so an assignment cannot disambiguate a
  // credential that arrived under an ambiguous gateway alias.
  const gateways = await readIdentity(() =>
    getCoreDb()
      .select({
        gatewayId: gateway.id,
        legacyServerId: gateway.legacyServerId,
        orgId: gateway.orgId,
      })
      .from(gateway)
      .where(or(eq(gateway.legacyServerId, serverId), sql`${gateway.id}::text = ${serverId}`))
      .limit(2),
  );
  const assignedGateway = gateways[0];
  if (
    gateways.length !== 1 ||
    !assignedGateway ||
    !assignedGateway.orgId ||
    assignedGateway.orgId !== tokenOrg ||
    (assignedGateway.gatewayId !== serverId && assignedGateway.legacyServerId !== serverId)
  ) {
    rejectAssistant(
      403,
      'ASSISTANT_GATEWAY_ASSIGNMENT_REQUIRED',
      'A current gateway assignment for this assistant is required.',
    );
  }
  if (requestedOrg && requestedOrg !== assignedGateway.orgId) {
    rejectAssistant(
      403,
      'ASSISTANT_ORG_NOT_ASSIGNED',
      'The assistant is not assigned to the requested organization.',
    );
  }

  const rows = await readIdentity(() =>
    getCoreDb()
      .select({
        principalId: personalAgents.profileId,
        agentId: personalAgents.agentId,
        provisioningStatus: personalAgents.provisioningStatus,
        gatewayId: personalAgents.gatewayId,
        orgId: gateway.orgId,
      })
      .from(personalAgents)
      .innerJoin(gateway, eq(gateway.id, personalAgents.gatewayId))
      .where(
        and(
          eq(personalAgents.gatewayId, assignedGateway.gatewayId),
          eq(gateway.orgId, tokenOrg),
          sql`lower(${personalAgents.agentId}) = lower(${agentId})`,
        ),
      )
      .limit(2),
  );
  const row = rows[0];
  if (
    rows.length !== 1 ||
    !row ||
    row.provisioningStatus !== 'active' ||
    row.agentId.toLowerCase() !== agentId.toLowerCase() ||
    row.gatewayId !== assignedGateway.gatewayId ||
    row.orgId !== assignedGateway.orgId
  ) {
    rejectAssistant(
      403,
      'ASSISTANT_GATEWAY_ASSIGNMENT_REQUIRED',
      'A current gateway assignment for this assistant is required.',
    );
  }
  return resolveMemberPrincipal(row.principalId, assignedGateway.orgId);
}

async function resolveMemberPrincipal(
  principalId: string,
  requestedOrg: string | null,
): Promise<AssistantPrincipal> {
  const response = await readIdentity(async () => {
    const result = await supabaseAdmin()
      .from('organization_members')
      .select('organization_id, role')
      .eq('profile_id', principalId);
    if (result.error) throw result.error;
    return result;
  });
  const rows = (response.data ?? []) as Array<{ organization_id: string; role: string | null }>;
  const chosen = requestedOrg ? rows.find((row) => row.organization_id === requestedOrg) : rows[0];
  if (!chosen) {
    rejectAssistant(
      403,
      'ASSISTANT_ORG_NOT_ASSIGNED',
      'The assistant is not assigned to the requested organization.',
    );
  }
  const capabilities = await readIdentity(() =>
    resolveCapabilities(chosen.organization_id, principalId),
  );
  return { principalId, orgId: chosen.organization_id, role: chosen.role, capabilities };
}

/**
 * Resolve the actor shared by assistant reads and actions. Gateway possession
 * grants no implicit delegation: only an active persisted personal-agent
 * assignment on that gateway and its current org can authorize a gateway call.
 * Browser callers remain self/admin-only and membership-checked. This resolver
 * never self-heals identity pointers or accepts a requested org as authority.
 */
export async function resolveAssistantPrincipal(
  locals: App.Locals,
  url: URL,
): Promise<AssistantPrincipal> {
  const agentId = url.searchParams.get('agentId');
  const userId = url.searchParams.get('userId');
  const requestedOrg = url.searchParams.get('orgId');

  if (locals.serverId) return resolveGatewayPrincipal(locals, agentId, userId, requestedOrg);
  if (!locals.user) throw error(401, 'Authentication required');
  if ((!agentId && !userId) || (agentId && userId))
    throw error(400, 'Provide one agentId or userId.');
  if (agentId && BRAIN_AGENT_RE.test(agentId))
    return resolveBrainAgentPrincipal(locals, agentId, requestedOrg);

  let principalId: string;
  if (agentId) {
    const rows = await readIdentity(() =>
      getCoreDb()
        .select({ principalId: personalAgents.profileId, agentId: personalAgents.agentId })
        .from(personalAgents)
        .where(sql`lower(${personalAgents.agentId}) = lower(${agentId})`)
        .limit(2),
    );
    if (rows.length !== 1 || rows[0].agentId.toLowerCase() !== agentId.toLowerCase()) {
      throw error(400, 'unresolvable principal');
    }
    principalId = rows[0].principalId;
  } else {
    if (!userId || !UUID_RE.test(userId)) throw error(400, 'unresolvable principal');
    principalId = userId;
  }
  if (locals.user.role !== 'admin' && locals.user.supabaseId !== principalId)
    throw error(403, 'forbidden');
  return resolveMemberPrincipal(principalId, requestedOrg);
}
