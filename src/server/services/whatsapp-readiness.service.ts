import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { TransactionSql } from 'postgres';
import { getPgClient } from '$server/db/pg-pool';
import { decrypt } from '$server/auth/crypto';
import { gatewayCallToInstance } from '$lib/server/gateway-rpc';
import {
  ACTIONS,
  MODULES,
  buildCapabilities,
  resolveMemberRoleKeys,
  type CapabilityOverrideRow,
} from './rbac.service';
import { assertWhatsAppUserActive } from './whatsapp-member-authority';

const name = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
const resultSchema = z
  .object({
    version: z.literal(1),
    agentId: name,
    profileId: name,
    orgId: name,
    channelId: name.optional(),
    checkedAt: z.number().int().nonnegative(),
    configHash: z.string().regex(/^[a-f0-9]{64}$/),
    ready: z.boolean(),
    canonicalMemory: z.boolean(),
    capabilityParity: z.boolean(),
    blockers: z
      .array(
        z
          .object({ code: name, message: z.string().min(1).max(2000), capability: name.optional() })
          .strict(),
      )
      .max(2000),
    capabilities: z
      .object({ hub: z.array(name).max(2000), whatsapp: z.array(name).max(2000) })
      .strict(),
  })
  .strict();
export type WhatsAppReadiness = z.infer<typeof resultSchema>;
/** Keep structured diagnostics in the response while satisfying SvelteKit's base error contract. */
export function rejectWhatsAppReadiness(message: string, readiness: unknown): never {
  const body = { message, readiness };
  return error(409, body);
}
export interface WhatsAppMemberBinding {
  orgId: string;
  profileId: string;
  gatewayId?: string;
  agentId?: string;
  channelId?: string;
  /** Only admission, immediately after its fresh GoTrue check, supplies this. */
  activeProfileChecked?: boolean;
  deadline?: number;
}
function blocked(binding: WhatsAppMemberBinding, code: string, message: string): WhatsAppReadiness {
  return {
    version: 1,
    agentId: binding.agentId ?? '',
    profileId: binding.profileId,
    orgId: binding.orgId,
    ...(binding.channelId ? { channelId: binding.channelId } : {}),
    checkedAt: Date.now(),
    configHash: '',
    ready: false,
    canonicalMemory: false,
    capabilityParity: false,
    blockers: [{ code, message }],
    capabilities: { hub: [], whatsapp: [] },
  };
}
/** An authenticated fresh RPC proves the hash; Hub validates its shape, not unknown gateway config. */
export function validateWhatsAppReadiness(
  raw: unknown,
  binding: WhatsAppMemberBinding,
  now = Date.now(),
): WhatsAppReadiness {
  const parsed = resultSchema.safeParse(raw);
  if (!parsed.success)
    return blocked(binding, 'invalid_readiness', 'Gateway returned an invalid readiness report');
  const value = parsed.data;
  const { hub, whatsapp } = value.capabilities;
  if (
    value.agentId !== binding.agentId ||
    value.profileId !== binding.profileId ||
    value.orgId !== binding.orgId ||
    value.channelId !== binding.channelId ||
    value.checkedAt < now - 30_000 ||
    value.checkedAt > now + 5_000 ||
    new Set(hub).size !== hub.length ||
    new Set(whatsapp).size !== whatsapp.length ||
    (value.capabilityParity &&
      (hub.length !== whatsapp.length || hub.some((item) => !whatsapp.includes(item)))) ||
    (value.ready &&
      (!value.canonicalMemory || !value.capabilityParity || value.blockers.length > 0))
  ) {
    return blocked(
      binding,
      'invalid_readiness',
      'Gateway readiness is stale, inconsistent, or belongs to another member',
    );
  }
  return value;
}
/** Same naming as gateway tool-search/custom-tools.ts. Ambiguous collisions remain unqualified. */
export function readinessCustomTools(rows: { name: string; execution_config: string | null }[]) {
  const used = new Set<string>();
  const tools: { name: string; permission?: { module: string; action: string } }[] = [];
  for (const row of rows) {
    const toolName = `custom_${
      row.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'tool'
    }`;
    // The existing endpoint orders only by updated_at. Do not guess collision suffixes when ties reorder rows.
    if (used.has(toolName) || !name.safeParse(toolName).success) return undefined;
    used.add(toolName);
    let permission: { module: string; action: string } | undefined;
    try {
      const candidate = JSON.parse(row.execution_config ?? '{}')?.permission;
      if (
        typeof candidate?.module === 'string' &&
        typeof candidate?.action === 'string' &&
        ACTIONS.includes(candidate.action as (typeof ACTIONS)[number])
      ) {
        if (!name.safeParse(candidate.module).success || !name.safeParse(candidate.action).success)
          return undefined;
        permission = { module: candidate.module, action: candidate.action };
      }
    } catch {
      /* The canonical custom-tools loader treats malformed config as no permission. */
    }
    tools.push({ name: toolName, ...(permission ? { permission } : {}) });
  }
  return tools;
}
/** No cache, secondary pool checkout, model/provider call, or gateway-to-Hub callback. */
export async function inspectWhatsAppMember(
  tx: TransactionSql,
  binding: WhatsAppMemberBinding,
): Promise<WhatsAppReadiness> {
  const rows =
    await tx`select pa.agent_id,pa.gateway_id,pa.provisioning_status,m.role,g.url,g.token_ciphertext,g.token_iv
    from personal_agents pa join organization_members m on m.profile_id=pa.profile_id and m.organization_id=${binding.orgId}
    join gateway g on g.id=pa.gateway_id and g.org_id=m.organization_id
    join organizations o on o.id=m.organization_id and o.status='active'
    where pa.profile_id=${binding.profileId}`;
  if (
    rows.length !== 1 ||
    (binding.gatewayId && rows[0].gateway_id !== binding.gatewayId) ||
    (binding.agentId && rows[0].agent_id !== binding.agentId)
  )
    return blocked(
      binding,
      'agent_assignment_unavailable',
      'A unique personal agent on this organization gateway is required',
    );
  const row = rows[0];
  const resolved = {
    ...binding,
    agentId: row.agent_id as string,
    gatewayId: row.gateway_id as string,
  };
  if (row.provisioning_status !== 'active')
    return blocked(resolved, 'agent_not_active', 'Finish personal agent provisioning first');
  if (!row.url || !row.token_ciphertext)
    return blocked(resolved, 'gateway_unavailable', 'Gateway credentials are unavailable');
  if (binding.channelId) {
    const channels =
      await tx`select id from channels where id=${binding.channelId} and tenant_id=${binding.orgId}
      and gateway_id=${row.gateway_id} and type='whatsapp' and owner_profile_id is null`;
    if (channels.length !== 1)
      return blocked(
        resolved,
        'channel_assignment_unavailable',
        'WhatsApp account does not belong to this organization gateway',
      );
  }
  const claims = await tx`select id from user_identities where user_id=${binding.profileId}
    and kind='channel' and provider='whatsapp' and verified_at is not null`;
  if (!claims.length)
    return blocked(
      resolved,
      'phone_claim_required',
      'Claim and verify a WhatsApp phone number first',
    );
  if ((binding.deadline ?? Infinity) <= Date.now())
    return blocked(resolved, 'readiness_incomplete', 'Readiness deadline reached');
  try {
    if (!binding.activeProfileChecked)
      await assertWhatsAppUserActive(
        binding.profileId,
        Math.max(1, Math.min(3000, (binding.deadline ?? Infinity) - Date.now())),
      );
  } catch {
    if ((binding.deadline ?? Infinity) <= Date.now())
      return blocked(resolved, 'readiness_incomplete', 'Readiness deadline reached');
    return blocked(
      resolved,
      'member_unavailable',
      'Member authentication is disabled or unavailable',
    );
  }
  const assigned =
    await tx`select role_key from member_roles where org_id=${binding.orgId} and profile_id=${binding.profileId}`;
  const roles = resolveMemberRoleKeys(
    assigned.map((r) => r.role_key as string),
    row.role,
  );
  const rules = await tx<
    CapabilityOverrideRow[]
  >`select role_key,module,can_view,can_create,can_edit,can_delete,can_export,can_manage,if_owner,field_level
    from permission_rules where org_id=${binding.orgId} and role_key in ${tx(roles)}`;
  const caps = buildCapabilities(roles, rules);
  // Match C2 discovery exactly; action-auth still independently checks current module enablement/org kind.
  const modules: Record<string, string[]> = {};
  for (const module of MODULES) {
    const allowed = ACTIONS.filter((action) => caps.can(module, action));
    if (allowed.length) modules[module] = allowed;
  }
  const customRows = await tx<
    { name: string; execution_config: string | null }[]
  >`select name,execution_config from built_tools
    where tenant_id=${binding.orgId} and status='published' and id<>'' and name<>'' and script_code<>''
      and script_lang in ('javascript','python','bash') order by updated_at desc limit 1001`;
  const customTools = customRows.length <= 1000 ? readinessCustomTools(customRows) : undefined;
  if (!customTools)
    return blocked(
      resolved,
      'custom_inventory_unverified',
      'Published tool names or permissions are ambiguous, invalid, or exceed the 1000-tool inspection limit',
    );
  try {
    if ((binding.deadline ?? Infinity) <= Date.now())
      return blocked(resolved, 'readiness_incomplete', 'Readiness deadline reached');
    const token = row.token_iv ? decrypt(row.token_ciphertext, row.token_iv) : row.token_ciphertext;
    const raw = await gatewayCallToInstance(
      row.url,
      token,
      'agents.whatsapp.readiness',
      {
        agentId: row.agent_id,
        profileId: binding.profileId,
        orgId: binding.orgId,
        ...(binding.channelId ? { channelId: binding.channelId } : {}),
        permissions: { modules },
        ...(customTools ? { customTools } : {}),
      },
      { timeoutMs: Math.max(1, Math.min(5000, (binding.deadline ?? Infinity) - Date.now())) },
    );
    if ((binding.deadline ?? Infinity) <= Date.now())
      return blocked(resolved, 'readiness_incomplete', 'Readiness deadline reached');
    return validateWhatsAppReadiness(raw, resolved);
  } catch {
    if ((binding.deadline ?? Infinity) <= Date.now())
      return blocked(resolved, 'readiness_incomplete', 'Readiness deadline reached');
    return blocked(
      resolved,
      'gateway_readiness_unavailable',
      'Gateway readiness could not be verified',
    );
  }
}
export async function getWhatsAppMemberReadiness(binding: WhatsAppMemberBinding) {
  return getPgClient().begin((tx) => inspectWhatsAppMember(tx, binding));
}
type AccountScope = { orgId: string; gatewayId: string; channelId?: string };
async function accountCandidates(scope: AccountScope, limit: number, cursor?: string) {
  return getPgClient().begin(async (tx) => {
    if (scope.channelId) {
      const accounts =
        await tx`select id from channels where id=${scope.channelId} and tenant_id=${scope.orgId}
        and gateway_id=${scope.gatewayId} and type='whatsapp' and owner_profile_id is null`;
      if (accounts.length !== 1) throw error(404, 'WhatsApp account not found');
    }
    return tx<{ profile_id: string }[]>`select distinct m.profile_id from organization_members m
      join user_identities i on i.user_id=m.profile_id and i.provider='whatsapp' and i.kind='channel' and i.verified_at is not null
      where m.organization_id=${scope.orgId} and (${cursor ?? null}::text is null or m.profile_id::text > ${cursor ?? ''})
      order by m.profile_id limit ${limit + 1}`;
  });
}
export async function getWhatsAppAccountReadiness(
  scope: AccountScope,
  page: { limit?: number; cursor?: string } = {},
) {
  const limit = page.limit ?? 20;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    (page.cursor !== undefined && !/^[a-f0-9-]{36}$/i.test(page.cursor))
  )
    throw error(400, 'Invalid readiness page');
  const candidates = await accountCandidates(scope, limit, page.cursor);
  const members: WhatsAppReadiness[] = [];
  const deadline = Date.now() + 15_000;
  // Return a continuation for unfinished work; never label an uninspected member qualified.
  for (let i = 0; i < Math.min(candidates.length, limit) && Date.now() < deadline; i += 4) {
    members.push(
      ...(await Promise.all(
        candidates
          .slice(i, Math.min(i + 4, limit))
          .map((m) => getWhatsAppMemberReadiness({ ...scope, profileId: m.profile_id, deadline })),
      )),
    );
  }
  const pendingIndex = members.findIndex((member) =>
    member.blockers.some((blocker) => blocker.code === 'readiness_incomplete'),
  );
  const complete = members.length === candidates.length && pendingIndex === -1;
  const ready = members.some((member) => member.ready);
  const nextCursor = complete
    ? null
    : pendingIndex === 0
      ? (page.cursor ?? null)
      : pendingIndex > 0
        ? members[pendingIndex - 1].profileId
        : members.length
          ? members[members.length - 1].profileId
          : (page.cursor ?? null);
  return {
    scope: 'member-runtime-preflight' as const,
    runtimeReady: ready,
    ready,
    members,
    complete,
    nextCursor,
    blockers: ready
      ? []
      : [
          {
            code: complete ? 'no_ready_members' : 'readiness_incomplete',
            message: complete
              ? 'At least one verified member needs a qualified personal agent'
              : 'Continue readiness inspection to check remaining members',
          },
        ],
  };
}
export async function requireWhatsAppAccountReady(scope: AccountScope) {
  const deadline = Date.now() + 15_000;
  let cursor: string | undefined;
  let inspected = 0;
  while (Date.now() < deadline) {
    const candidates = await accountCandidates(scope, 4, cursor);
    const batch = candidates.slice(0, 4);
    const members = await Promise.all(
      batch.map((m) => getWhatsAppMemberReadiness({ ...scope, profileId: m.profile_id, deadline })),
    );
    inspected += members.length;
    if (members.some((member) => member.ready)) return;
    if (
      members.some((member) =>
        member.blockers.some((blocker) => blocker.code === 'readiness_incomplete'),
      )
    )
      break;
    if (candidates.length <= 4)
      rejectWhatsAppReadiness('WhatsApp account has no ready personal agent', {
        ready: false,
        complete: true,
        inspected,
        members,
        blockers: [
          {
            code: 'no_ready_members',
            message: 'No claimed member has a qualified personal agent',
          },
        ],
      });
    cursor = batch[batch.length - 1].profile_id;
  }
  rejectWhatsAppReadiness('WhatsApp readiness inspection exceeded its time budget', {
    ready: false,
    complete: false,
    inspected,
    blockers: [
      { code: 'readiness_incomplete', message: 'Retry after resolving reported member blockers' },
    ],
  });
}
