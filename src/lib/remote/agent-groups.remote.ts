/**
 * Remote functions for agent groups (consumed by
 * $lib/state/features/agent-groups.svelte.ts). Mirrors the
 * `/api/servers/[id]/agent-groups*` routes' service calls. Note: groups are
 * scoped per user+tenant — the `serverId` URL segment in the REST routes is
 * vestigial (the service ignores it), so these functions take no serverId.
 *
 * The consumer keeps its `CachedStore` wrapper (sessionStorage + tag-based
 * invalidation, part of the cross-cutting cache layer); only the raw fetches
 * inside it are replaced here.
 */
import { query, command } from '$app/server';
import { z } from 'zod';
import { currentUser, currentCtx } from '$server/remote/guard';
import {
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  addAgentToGroup,
  removeAgentFromGroup,
} from '$server/services/agent-group.service';

/** Agent groups for the current user+tenant. */
export const getAgentGroups = query(async () => {
  const user = currentUser();
  const ctx = currentCtx();
  return listGroups(ctx, user.id);
});

/** Create a group. Returns `{ group }`. */
export const createAgentGroup = command(z.object({ name: z.string().trim().min(1) }), async ({ name }) => {
  const user = currentUser();
  const ctx = currentCtx();
  const group = await createGroup(ctx, user.id, name);
  return { group };
});

/** Update a group's name and/or sort order. */
export const updateAgentGroup = command(
  z.object({
    groupId: z.string().min(1),
    name: z.string().optional(),
    sortOrder: z.number().optional(),
  }),
  async ({ groupId, name, sortOrder }) => {
    const user = currentUser();
    const ctx = currentCtx();
    await updateGroup(ctx, user.id, groupId, { name, sortOrder });
    return { ok: true as const };
  },
);

/** Delete a group. */
export const deleteAgentGroup = command(z.string().min(1), async (groupId) => {
  const user = currentUser();
  const ctx = currentCtx();
  await deleteGroup(ctx, user.id, groupId);
  return { ok: true as const };
});

/** Add an agent to a group. */
export const addAgentToGroupRemote = command(
  z.object({ groupId: z.string().min(1), agentId: z.string().min(1) }),
  async ({ groupId, agentId }) => {
    const user = currentUser();
    const ctx = currentCtx();
    await addAgentToGroup(ctx, user.id, groupId, agentId);
    return { ok: true as const };
  },
);

/** Remove an agent from a group. */
export const removeAgentFromGroupRemote = command(
  z.object({ groupId: z.string().min(1), agentId: z.string().min(1) }),
  async ({ groupId, agentId }) => {
    const user = currentUser();
    const ctx = currentCtx();
    await removeAgentFromGroup(ctx, user.id, groupId, agentId);
    return { ok: true as const };
  },
);
