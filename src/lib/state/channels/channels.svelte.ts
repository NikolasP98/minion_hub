import { fetchJson } from '$lib/api/fetch-json';
import type { Channel, ChannelAssignment } from '$lib/types/channels';
import type { ChannelType, ChannelStatus } from '$lib/types/channels';

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

function apiBase(serverId: string) {
  return `/api/servers/${serverId}/channels`;
}

export async function fetchChannels(serverId: string, isCurrent: () => boolean = () => true) {
  if (!isCurrent()) return;
  channelState.loading = true;
  channelState.error = null;
  try {
    const res = await fetch(apiBase(serverId));
    if (!res.ok) throw new Error(`Failed to load channels: ${res.status}`);
    const data = await res.json();
    if (isCurrent()) channelState.channels = data.channels;
  } catch (e) {
    if (isCurrent()) channelState.error = e instanceof Error ? e.message : String(e);
  } finally {
    if (isCurrent()) channelState.loading = false;
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
  const res = await fetch(apiBase(serverId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to create channel: ${res.status}`);
  const data = await res.json();
  await fetchChannels(serverId);
  return data.id as string;
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
  isCurrent: () => boolean = () => true,
) {
  const res = await fetch(`${apiBase(serverId)}/${channelId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to update channel: ${res.status}`);
  if (isCurrent()) await fetchChannels(serverId, isCurrent);
}

export async function deleteChannel(
  serverId: string,
  channelId: string,
  isCurrent: () => boolean = () => true,
) {
  await fetchJson(`${apiBase(serverId)}/${channelId}`, { method: 'DELETE' });
  // Acknowledged deletion must never be replayed because a later read failed.
  if (!isCurrent()) return;
  if (channelState.selectedChannelId === channelId) channelState.selectedChannelId = null;
  channelState.channels = channelState.channels.filter((channel) => channel.id !== channelId);
  await fetchChannels(serverId, isCurrent);
}

export async function fetchChannelAssignments(
  serverId: string,
  channelId: string,
): Promise<ChannelAssignment[]> {
  const res = await fetch(`${apiBase(serverId)}/${channelId}/assignments`);
  if (!res.ok) throw new Error(`Failed to load assignments: ${res.status}`);
  const data = await res.json();
  return data.assignments;
}

export async function assignChannel(
  serverId: string,
  channelId: string,
  targetType: 'user' | 'session',
  targetId: string,
) {
  const res = await fetch(`${apiBase(serverId)}/${channelId}/assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetType, targetId }),
  });
  if (!res.ok) throw new Error(`Failed to assign channel: ${res.status}`);
}

export async function unassignChannel(serverId: string, channelId: string, assignmentId: string) {
  const res = await fetch(
    `${apiBase(serverId)}/${channelId}/assignments?assignmentId=${assignmentId}`,
    {
      method: 'DELETE',
    },
  );
  if (!res.ok) throw new Error(`Failed to unassign: ${res.status}`);
}
