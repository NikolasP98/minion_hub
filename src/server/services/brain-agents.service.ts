import { error } from '@sveltejs/kit';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore } from '$server/db/with-org-core';
import { brainAgentTemplates, type BrainAgentTemplate } from '$server/db/pg-schema/brain-agents';
import { brains, brainAccess, type Brain } from '$server/db/pg-schema/brains';
import { recordAudit } from './activity.service';
import { gatewayCall } from '$lib/server/gateway-rpc';

/**
 * P4.1 AI-Brains — managed agents. One org-level "Brain Agent Template"
 * provisions/reconfigures every brain's managing gateway agent (archetype
 * 'brain'). Mirrors `personal-agent-provisioner.ts` +
 * `/api/personal-agent/create`'s privileged gateway-call shape exactly: the
 * hub performs `agents.create` + `config.patch` with the system gateway
 * credentials (operator.admin scope), never the browser.
 *
 * RBAC: every export here assumes the caller already holds `brains:manage`
 * (enforced at the API layer via `requireOrgCapability`) — this service does
 * not re-check it, same division of labor as `brains.service.ts`'s coarse
 * module gate vs. its own fine-grained `canAccessBrain`.
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

async function loadBrainRow(ctx: CoreCtx, brainId: string): Promise<Brain | null> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(brains)
      .where(and(eq(brains.id, brainId), eq(brains.orgId, ctx.tenantId)))
      .limit(1),
  );
  return row ?? null;
}

// ── Template CRUD ────────────────────────────────────────────────────────

/** Returns the org's template, or an unsaved default (id:'') if none exists
 *  yet — ponytail: simplest "create on first read" is "don't insert at all
 *  until the org actually saves something"; `updateTemplate` upserts. */
export async function getTemplate(ctx: CoreCtx): Promise<BrainAgentTemplate> {
  const [row] = await withOrgCore(ctx, (tx) =>
    tx.select().from(brainAgentTemplates).where(eq(brainAgentTemplates.orgId, ctx.tenantId)).limit(1),
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
      .onConflictDoUpdate({ target: brainAgentTemplates.orgId, set: { ...values, updatedAt: new Date() } })
      .returning(),
  );
  await recordAudit(ctx, {
    refType: 'brain_agent_template',
    refId: row.id,
    op: 'update',
    changes: [{ field: 'instructions', label: 'Instructions', old: current.instructions, new: row.instructions }],
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
  const brain = await loadBrainRow(ctx, brainId);
  if (!brain) throw error(404, 'brain not found');
  if (brain.agentId) return { agentId: brain.agentId };

  const template = await getTemplate(ctx);
  const agentId = deriveBrainAgentId(brainId);

  try {
    await gatewayCall('agents.create', { name: agentId, workspace: `~/.minion/agents/${agentId}/workspace` });
  } catch (err) {
    if (!(err instanceof Error && /already exists/i.test(err.message))) throw err;
  }
  await patchBrainAgentConfig(agentId, template, brain);

  await withOrgCore(ctx, async (tx) => {
    await tx
      .update(brains)
      .set({ agentId, updatedAt: new Date() })
      .where(and(eq(brains.id, brainId), eq(brains.orgId, ctx.tenantId)));
    await tx
      .insert(brainAccess)
      .values({ brainId, orgId: ctx.tenantId, principalType: 'agent', principalId: agentId, level: 'write' })
      .onConflictDoNothing();
  });

  await recordAudit(ctx, {
    refType: 'brain',
    refId: brainId,
    op: 'update',
    changes: [{ field: 'agent_id', label: 'Managing agent', old: null, new: agentId }],
    actor,
  });

  // P4.2 (done): the brain agent can now call hub gateway APIs as itself —
  // resolveAssistantPrincipal (assistant-principal.ts) resolves `brain-<uuid>`
  // via this row's `brains.agent_id` into a brains-only principal.

  return { agentId };
}

/**
 * Disable agent management for a brain: deletes the gateway agent, clears
 * `brains.agent_id`, and removes its `brain_access` row. Idempotent — a
 * brain with no agent is a no-op.
 */
export async function deprovisionBrainAgent(ctx: CoreCtx, brainId: string, actor: Actor): Promise<void> {
  const brain = await loadBrainRow(ctx, brainId);
  if (!brain?.agentId) return;
  const agentId = brain.agentId;

  try {
    await gatewayCall('agents.delete', { agentId });
  } catch (err) {
    if (!(err instanceof Error && /not found/i.test(err.message))) throw err;
  }

  await withOrgCore(ctx, async (tx) => {
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
  });

  await recordAudit(ctx, {
    refType: 'brain',
    refId: brainId,
    op: 'update',
    changes: [{ field: 'agent_id', label: 'Managing agent', old: agentId, new: null }],
    actor,
  });
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
