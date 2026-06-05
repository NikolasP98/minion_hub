import type { Channel, ChannelAssignment } from '$lib/types/channels';
import type { ChannelType, ChannelStatus } from '$lib/types/channels';
import * as channelRemote from '$lib/remote/channels.remote';

export const channelState = $state({
  channels: [] as Channel[],
  loading: false,
  error: null as string | null,
  selectedChannelId: null as string | null,
});

export function getSelectedChannel(): Channel | null {
  if (!channelState.selectedChannelId) return null;
  return channelState.channels.find((c) => c.id === channelState.selectedChannelId) ?? null;
}

export async function fetchChannels(serverId: string) {
  channelState.loading = true;
  channelState.error = null;
  try {
    channelState.channels = (await channelRemote.getChannels(serverId)) as Channel[];
  } catch (e) {
    channelState.error = e instanceof Error ? e.message : String(e);
  } finally {
    channelState.loading = false;
  }
}

export async function createChannel(
  serverId: string,
  input: {
    type: ChannelType;
    label: string;
    credentials?: Record<string, string>;
    credentialsMeta?: Record<string, string>;
    status?: ChannelStatus;
  },
) {
  const { id } = await channelRemote.createChannel({ serverId, ...input });
  await fetchChannels(serverId);
  return id;
}

export async function updateChannel(
  serverId: string,
  channelId: string,
  input: Partial<{
    label: string;
    credentials: Record<string, string>;
    credentialsMeta: Record<string, string>;
    status: ChannelStatus;
  }>,
) {
  await channelRemote.updateChannel({ serverId, channelId, ...input });
  await fetchChannels(serverId);
}

export async function deleteChannel(serverId: string, channelId: string) {
  await channelRemote.deleteChannel({ serverId, channelId });
  if (channelState.selectedChannelId === channelId) channelState.selectedChannelId = null;
  await fetchChannels(serverId);
}

export async function fetchChannelAssignments(
  _serverId: string,
  channelId: string,
): Promise<ChannelAssignment[]> {
  return (await channelRemote.getChannelAssignments(channelId)) as ChannelAssignment[];
}

export async function assignChannel(
  _serverId: string,
  channelId: string,
  targetType: 'user' | 'session',
  targetId: string,
) {
  await channelRemote.assignChannel({ channelId, targetType, targetId });
}

export async function unassignChannel(_serverId: string, _channelId: string, assignmentId: string) {
  await channelRemote.unassignChannel(assignmentId);
}
