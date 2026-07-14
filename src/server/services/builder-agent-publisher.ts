export interface RuntimeAgentDraft {
  id: string;
  tenantId: string;
  name: string;
  emoji: string | null;
  model: string | null;
  systemPrompt: string | null;
  runtimeAgentId: string | null;
}

export type GatewayRpc = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export function runtimeAgentIdForDraft(draftId: string): string {
  return `built-${draftId}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .slice(0, 64);
}

/**
 * Idempotently create/update the runtime counterpart for a Hub authoring draft.
 * The deterministic first-publish ID makes retries safe if gateway creation
 * succeeds but persistence is interrupted.
 */
export async function synchronizeRuntimeAgent(
  draft: RuntimeAgentDraft,
  rpc: GatewayRpc,
): Promise<{ runtimeAgentId: string; created: boolean }> {
  let runtimeAgentId = draft.runtimeAgentId ?? runtimeAgentIdForDraft(draft.id);
  let created = false;

  if (!draft.runtimeAgentId) {
    try {
      const result = (await rpc('agents.create', {
        name: runtimeAgentId,
        workspace: `~/.minion/agents/${runtimeAgentId}/workspace`,
        ...(draft.model ? { model: draft.model } : {}),
        ...(draft.emoji ? { emoji: draft.emoji } : {}),
      })) as { agentId?: string };
      runtimeAgentId = result.agentId ?? runtimeAgentId;
      created = true;
    } catch (cause) {
      if (!(cause instanceof Error && /already exists/i.test(cause.message))) throw cause;
    }
  }

  await rpc('agents.update', {
    agentId: runtimeAgentId,
    name: draft.name,
    workspace: `~/.minion/agents/${runtimeAgentId}/workspace`,
    ...(draft.model ? { model: draft.model } : {}),
  });

  const config = (await rpc('config.get', {})) as { hash?: string };
  await rpc('config.patch', {
    raw: JSON.stringify({
      agents: {
        list: [
          {
            id: runtimeAgentId,
            name: draft.name,
            orgIds: [draft.tenantId],
            identity: { name: draft.name, ...(draft.emoji ? { emoji: draft.emoji } : {}) },
            ...(draft.model ? { model: { primary: draft.model } } : {}),
            personality: {
              preset: 'professional',
              configured: true,
              conversationName: draft.name,
              text: draft.systemPrompt ?? '',
            },
          },
        ],
      },
    }),
    baseHash: config?.hash,
    note: `Publish Hub agent draft ${draft.id}`,
  });

  return { runtimeAgentId, created };
}
