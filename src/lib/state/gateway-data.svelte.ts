import type { Agent, Session, PresenceEntry, HelloOk } from '$lib/types/gateway';

export const gw = $state({
  hello: null as HelloOk | null,
  agents: [] as Agent[],
  defaultAgentId: null as string | null,
  sessions: [] as Session[],
  presence: [] as PresenceEntry[],
  health: null as unknown,
  channels: null as unknown,
  cronJobs: [] as unknown[],
  lastSeq: null as number | null,
});
