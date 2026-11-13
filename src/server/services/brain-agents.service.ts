import { error } from '@sveltejs/kit';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore } from '$server/db/with-org-core';
import { brainAgentTemplates, type BrainAgentTemplate } from '$server/db/pg-schema/brain-agents';
import { brains, brainAccess, type Brain } from '$server/db/pg-schema/brains';
import { recordAudit, recordAuditInTx } from './activity.service';
import { withBrainWriteAuthority } from './brain-access-grants.service';
import { gatewayCall } from '$lib/server/gateway-rpc';

/**
 * P4.1 AI-Brains — managed agents. One org-level "Brain Agent Template"
 * provisions/reconfigures every brain's managing gateway agent (archetype
 * 'brain'). Mirrors `personal-agent-provisioner.ts` +
 * `/api/personal-agent/create`'s privileged gateway-call shape exactly: the
 * hub performs `agents.create` + `config.patch` with the system gateway
 * credentials (operator.admin scope), never the browser.
 *
 * Provisioning and deprovisioning independently recheck current module and
 * per-brain authority at preflight and at the database grant boundary. Other
 * exports retain their API-layer brains:manage gate.
 */

type Actor = { id: string | null; name: string | null };

export interface FanOutResult {
  agentId: string;
  ok: boolean;
  error?: string;
}

export function deriveBrainAgentId(brainId: string): string {
  return `brain-${brainId}`;
}

/**
 * Agent ids (`brain-<uuid>`) of every provisioned brain agent in the org —
 * for the hub's client-side agent roster org partition (`filterAgentsByOrg`
 * in `agent-org.ts`), which otherwise can't place these by name. Single
 * indexed select; org-scoped via `withOrgCore` like the rest of this file.
 */
export async function listBrainAgentIds(ctx: CoreCtx): Promise<string[]> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({ agentId: brains.agentId })
      .from(brains)
      .where(and(eq(brains.orgId, ctx.tenantId), isNotNull(brains.agentId))),
  );
  return rows.map((r) => r.agentId as string);
}

const DEFAULT_INSTRUCTIONS =
  'You are the managing agent for the "{{brain_name}}" knowledge base. {{brain_description}}\n\n' +
  'Answer using only what is stored in this knowledge base, and say so plainly when you do not know.';

function defaultTemplate(orgId: string): BrainAgentTemplate {
  const now = new Date();
  return {
    id: '',
    orgId,
    namePrefix: 'Brain',
    emoji: null,
    model: null,
    instructions: DEFAULT_INSTRUCTIONS,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Template CRUD ────────────────────────────────────────────────────────

/** Returns the org's template, or an unsaved default (id:'') if none exists
 *  yet — ponytail: simplest "create on first read" is "don't insert at all
 *  until the org actually saves something"; `updateTemplate` upserts. */
export async function getTemplate(ctx: CoreCtx): Promise<BrainAgentTemplate> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(brainAgentTemplates)
      .where(eq(brainAgentTemplates.orgId, ctx.tenantId))
      .limit(1),
  );
  return row ?? defaultTemplate(ctx.tenantId);
}

export async function updateTemplate(
  ctx: CoreCtx,
  patch: Partial<Pick<BrainAgentTemplate, 'namePrefix' | 'emoji' | 'model' | 'instructions'>>,
  actor: Actor,
): Promise<BrainAgentTemplate> {
  const current = await getTemplate(ctx);
  const values = {
    orgId: ctx.tenantId,
    namePrefix: patch.namePrefix ?? current.namePrefix,
    emoji: patch.emoji !== undefined ? patch.emoji : current.emoji,
    model: patch.model !== undefined ? patch.model : current.model,
    instructions: patch.instructions ?? current.instructions,
  };
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .insert(brainAgentTemplates)
      .values(values)
      .onConflictDoUpdate({
        target: brainAgentTemplates.orgId,
        set: { ...values, updatedAt: new Date() },
      })
      .returning(),
  );
  await recordAudit(ctx, {
    refType: 'brain_agent_template',
    refId: row.id,
    op: 'update',
    changes: [
      {
        field: 'instructions',
        label: 'Instructions',
        old: current.instructions,
        new: row.instructions,
      },
    ],
    actor,
  });
  return row;
}

// ── Rendering (pure) ─────────────────────────────────────────────────────

/** Substitutes `{{brain_name}}` / `{{brain_description}}` in the template's
 *  instructions. Pure — no I/O — so it's directly unit-testable. */
export function renderTemplate(
  template: Pick<BrainAgentTemplate, 'instructions'>,
  brain: Pick<Brain, 'name' | 'description'>,
): string {
  return template.instructions
    .replaceAll('{{brain_name}}', brain.name)
    .replaceAll('{{brain_description}}', brain.description ?? '');
}

// ── Gateway calls ────────────────────────────────────────────────────────

/**
 * Push the rendered template to one brain agent's config. Same
 * `config.get` (baseHash) → `config.patch` shape the personal-agent create
 * endpoint uses. `personality.text` carries the rendered instructions — the
 * only free-text "system prompt" field the gateway config schema exposes
 * (see personal-agent/create/+server.ts).
 */
async function patchBrainAgentConfig(
  agentId: string,
  template: BrainAgentTemplate,
  brain: Pick<Brain, 'name' | 'description' | 'orgId'>,
): Promise<void> {
  const displayName = `${template.namePrefix}: ${brain.name}`;
  const instructions = renderTemplate(template, brain);
  const cfgSnapshot = (await gatewayCall('config.get', {})) as { hash?: string } | null;
  await gatewayCall('config.patch', {
    raw: JSON.stringify({
      agents: {
        list: [
          {
            id: agentId,
            name: displayName,
            archetype: 'brain',
            // Gateway-side org scoping (org-scope.ts's orgScopeVisible / JWT
            // orgId gate) — same field the hub's client-side agent-org
            // partition (agent-org.ts) reads back via listBrainAgentIds.
            orgIds: [brain.orgId],
            identity: { name: displayName, ...(template.emoji ? { emoji: template.emoji } : {}) },
            ...(template.model ? { model: { primary: template.model } } : {}),
            personality: {
              preset: 'professional',
              configured: true,
              conversationName: displayName,
              text: instructions,
            },
          },
        ],
      },
    }),
    baseHash: cfgSnapshot?.hash,
    note: `Update brain agent ${agentId}`,
  });
}

/**
 * Enable agent management for a brain: creates the gateway agent (archetype
 * 'brain'), configures it from the org template, stores `brains.agent_id`,
 * and grants it write access via `brain_access`. Idempotent — a brain that
 * already has an agent just returns it.
 */
export async function provisionBrainAgent(
  ctx: CoreCtx,
  brainId: string,
  actor: Actor,
): Promise<{ agentId: string }> {
  const principal = { profileId: ctx.profileId };
  const brain = await withBrainWriteAuthority(
    ctx,
    brainId,
    principal,
    async ({ brain }) => brain,
    undefined,
    { requireManage: true },
  );
  if (brain.agentId) return { agentId: brain.agentId };
  const template = await getTemplate(ctx);
  const agentId = deriveBrainAgentId(brainId);

  // RPCs deliberately run outside SQL locks. Partial remote setup remains
  // unbound until the fresh finalizer commits; retry reuses the same agent ID.
  try {
    await gatewayCall('agents.create', {
      name: agentId,
      workspace: `~/.minion/agents/${agentId}/workspace`,
    });
  } catch (err) {
    if (!(err instanceof Error && /already exists/i.test(err.message))) throw err;
  }
  await patchBrainAgentConfig(agentId, template, brain);

  return withBrainWriteAuthority(
    ctx,
    brainId,
    principal,
    async ({ tx, brain: current, profileId }) => {
      if (current.agentId) return { agentId: current.agentId };
      await tx
        .update(brains)
        .set({ agentId, updatedAt: new Date() })
        .where(and(eq(brains.id, brainId), eq(brains.orgId, ctx.tenantId)));
      await tx
        .insert(brainAccess)
        .values({
          brainId,
          orgId: ctx.tenantId,
          principalType: 'agent',
          principalId: agentId,
          level: 'write',
        })
        .onConflictDoNothing();
      await recordAuditInTx(tx, ctx, {
        refType: 'brain',
        refId: brainId,
        op: 'update',
        changes: [{ field: 'agent_id', label: 'Managing agent', old: null, new: agentId }],
        actor: { id: profileId, name: actor.name },
      });
      return { agentId };
    },
    undefined,
    { requireManage: true },
  );
}

/**
 * Disable the gateway agent, then remove its binding and ACL in a fresh
 * authorized transaction. A remote not-found result permits retry after
 * partial success. Gateway effects and the database commit are separate.
 */
export async function deprovisionBrainAgent(
  ctx: CoreCtx,
  brainId: string,
  actor: Actor,
): Promise<void> {
  const principal = { profileId: ctx.profileId };
  const brain = await withBrainWriteAuthority(
    ctx,
    brainId,
    principal,
    async ({ brain }) => brain,
    undefined,
    { requireManage: true },
  );
  if (!brain.agentId) return;
  const agentId = brain.agentId;
  try {
    await gatewayCall('agents.delete', { agentId });
  } catch (err) {
    if (!(err instanceof Error && /not found/i.test(err.message))) throw err;
  }
  await withBrainWriteAuthority(
    ctx,
    brainId,
    principal,
    async ({ tx, brain: current, profileId }) => {
      if (!current.agentId) return;
      if (current.agentId !== agentId)
        throw error(409, 'Brain agent changed; refresh before retrying');
      await tx
        .update(brains)
        .set({ agentId: null, updatedAt: new Date() })
        .where(and(eq(brains.id, brainId), eq(brains.orgId, ctx.tenantId)));
      await tx
        .delete(brainAccess)
        .where(
          and(
            eq(brainAccess.brainId, brainId),
            eq(brainAccess.orgId, ctx.tenantId),
            eq(brainAccess.principalType, 'agent'),
            eq(brainAccess.principalId, agentId),
          ),
        );
      await recordAuditInTx(tx, ctx, {
        refType: 'brain',
        refId: brainId,
        op: 'update',
        changes: [{ field: 'agent_id', label: 'Managing agent', old: agentId, new: null }],
        actor: { id: profileId, name: actor.name },
      });
    },
    undefined,
    { requireManage: true },
  );
}

/**
 * Reconfigure every brain agent already provisioned in the org from the
 * current template ("reconfigure once, all impacted" guarantee). Failures
 * are collected per-agent — one unreachable gateway/agent never aborts the
 * rest of the batch.
 */
export async function fanOutTemplate(ctx: CoreCtx): Promise<FanOutResult[]> {
  const template = await getTemplate(ctx);
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(brains)
      .where(and(eq(brains.orgId, ctx.tenantId), isNotNull(brains.agentId))),
  );

  const results: FanOutResult[] = [];
  for (const brain of rows) {
    const agentId = brain.agentId as string;
    try {
      await patchBrainAgentConfig(agentId, template, brain);
      results.push({ agentId, ok: true });
    } catch (err) {
      results.push({ agentId, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}
