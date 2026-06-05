/**
 * Remote functions for server channels (consumed by channels.svelte.ts).
 * Mirrors `/api/servers/[id]/channels`, `.../[channelId]`, and
 * `.../[channelId]/assignments`. Preserves the routes' `isValid*` guards
 * (400 on bad type/status/targetType). The QR endpoint is left as a route.
 */
import { query, command } from '$app/server';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { currentCtx } from '$server/remote/guard';
import * as channelSvc from '$server/services/channel.service';
import type { ChannelType, ChannelStatus } from '$lib/types/channels';

/** Channels for a server. */
export const getChannels = query(z.string().min(1), async (serverId) => {
  const ctx = currentCtx();
  return channelSvc.listChannels(ctx, serverId);
});

/** Create a channel. Returns its id. */
export const createChannel = command(
  z.object({
    serverId: z.string().min(1),
    type: z.string().min(1),
    label: z.string().min(1),
    credentials: z.record(z.string(), z.string()).optional(),
    credentialsMeta: z.record(z.string(), z.string()).optional(),
    status: z.string().optional(),
  }),
  async ({ serverId, type, label, credentials, credentialsMeta, status }) => {
    const ctx = currentCtx();
    if (!channelSvc.isValidChannelType(type)) error(400, `Invalid channel type: ${type}`);
    const id = await channelSvc.createChannel(ctx, serverId, {
      type: type as ChannelType,
      label,
      credentials,
      credentialsMeta,
      status: status as ChannelStatus | undefined,
    });
    return { id };
  },
);

/** Update a channel's label/status/credentials. */
export const updateChannel = command(
  z.object({
    serverId: z.string().min(1),
    channelId: z.string().min(1),
    label: z.string().optional(),
    credentials: z.record(z.string(), z.string()).optional(),
    credentialsMeta: z.record(z.string(), z.string()).optional(),
    status: z.string().optional(),
  }),
  async ({ serverId, channelId, label, credentials, credentialsMeta, status }) => {
    const ctx = currentCtx();
    const existing = await channelSvc.getChannel(ctx, channelId, serverId);
    if (!existing) error(404, 'Channel not found');

    const input: Record<string, unknown> = {};
    if (label !== undefined) input.label = label;
    if (status !== undefined) {
      if (!channelSvc.isValidChannelStatus(status)) error(400, `Invalid status: ${status}`);
      input.status = status;
    }
    if (credentials !== undefined) input.credentials = credentials;
    if (credentialsMeta !== undefined) input.credentialsMeta = credentialsMeta;

    await channelSvc.updateChannel(ctx, channelId, input, serverId);
    return { ok: true as const };
  },
);

/** Delete a channel. */
export const deleteChannel = command(
  z.object({ serverId: z.string().min(1), channelId: z.string().min(1) }),
  async ({ serverId, channelId }) => {
    const ctx = currentCtx();
    await channelSvc.deleteChannel(ctx, channelId, serverId);
    return { ok: true as const };
  },
);

/** Assignments (user/session targets) for a channel. */
export const getChannelAssignments = query(z.string().min(1), async (channelId) => {
  const ctx = currentCtx();
  return channelSvc.listChannelAssignments(ctx, channelId);
});

/** Assign a channel to a user or session. Returns the assignment id. */
export const assignChannel = command(
  z.object({
    channelId: z.string().min(1),
    targetType: z.string().min(1),
    targetId: z.string().min(1),
  }),
  async ({ channelId, targetType, targetId }) => {
    const ctx = currentCtx();
    if (!channelSvc.isValidTargetType(targetType)) error(400, `Invalid targetType: ${targetType}`);
    const id = await channelSvc.assignChannel(ctx, channelId, targetType, targetId);
    return { id };
  },
);

/** Remove a channel assignment. */
export const unassignChannel = command(z.string().min(1), async (assignmentId) => {
  const ctx = currentCtx();
  await channelSvc.unassignChannel(ctx, assignmentId);
  return { ok: true as const };
});
