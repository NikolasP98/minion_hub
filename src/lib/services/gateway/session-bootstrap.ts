type Request = (method: string, params?: unknown) => Promise<unknown>;
export interface SessionBootstrap {
  current: () => boolean;
  request: Request;
  fetcher: typeof fetch;
  agents: (value: unknown, initial: boolean) => void;
  sessions: (value: unknown) => void;
  health: (value: unknown) => void;
  presence: (value: unknown) => void;
  channels: (value: unknown) => void;
  cron: (value: unknown) => void;
  agentsError: (error: unknown) => void;
}

/** Own the bootstrap and polling lifetime; old promises cannot publish or dispatch on a new host. */
export function startSessionBootstrap(options: SessionBootstrap): () => void {
  let stopped = false;
  const current = () => !stopped && options.current();
  const abort = new AbortController();
  let agentsBusy = false;
  let presenceBusy = false;
  let poll: ReturnType<typeof setInterval> | undefined;
  let presencePoll: ReturnType<typeof setInterval> | undefined;
  const read = (method: string, apply: (value: unknown) => void, onError?: (e: unknown) => void) =>
    options
      .request(method, {})
      .then((value) => {
        if (current()) apply(value);
      })
      .catch((error: unknown) => {
        if (current()) onError?.(error);
      });

  void read('agents.list', (value) => options.agents(value, true), options.agentsError);
  void read('sessions.list', options.sessions);
  void read('health', options.health);
  void read('system-presence', options.presence);
  void read('channels.status', options.channels);
  void read('cron.list', options.cron);

  void options
    .fetcher('/api/flows?active=true', { signal: abort.signal })
    .then(async (response) => {
      if (!response.ok || !current()) return;
      const body = (await response.json()) as {
        flows?: Array<{ id: string; nodes: Array<{ type: string; data: unknown }> }>;
      };
      for (const flow of body.flows ?? []) {
        if (!current()) return;
        const node = flow.nodes.find((n) => n.type === 'trigger' || n.type === 'pluginTrigger');
        if (!node) continue;
        const data = node.data as {
          event: string;
          deliverResponse: boolean;
          sources?: { channel: string; accountId?: string }[];
          channels?: string[];
          filterChannelId?: string;
          filterAgentId?: string;
        };
        const sources = data.sources?.length
          ? data.sources
          : data.channels?.length
            ? data.channels.map((channel) => ({ channel }))
            : data.filterChannelId
              ? [{ channel: data.filterChannelId }]
              : [];
        // Captured transport, never the mutable global sendRequest client.
        await options
          .request('flows.trigger.register', {
            flowId: flow.id,
            event: data.event,
            deliverResponse: data.deliverResponse,
            filterChannelIds: sources.length
              ? [...new Set(sources.map((s) => s.channel))]
              : undefined,
            filterChannelAccounts: sources.length ? sources : undefined,
            filterAgentId: data.filterAgentId,
          })
          .catch(() => {});
      }
    })
    .catch(() => {});

  const delay = setTimeout(() => {
    if (!current()) return;
    poll = setInterval(() => {
      if (!current() || agentsBusy) return;
      agentsBusy = true;
      void Promise.allSettled([
        options.request('agents.list', {}),
        options.request('sessions.list', {}),
        options.request('channels.status', {}),
      ])
        .then(([agents, sessions, channels]) => {
          if (!current()) return;
          if (agents.status === 'fulfilled') options.agents(agents.value, false);
          if (sessions.status === 'fulfilled') options.sessions(sessions.value);
          if (channels.status === 'fulfilled') options.channels(channels.value);
        })
        .finally(() => {
          agentsBusy = false;
        });
    }, 30_000);
    presencePoll = setInterval(() => {
      if (!current() || presenceBusy) return;
      presenceBusy = true;
      void read('system-presence', options.presence).finally(() => {
        presenceBusy = false;
      });
    }, 60_000);
  }, 3_000);

  return () => {
    stopped = true;
    abort.abort();
    clearTimeout(delay);
    clearInterval(poll);
    clearInterval(presencePoll);
  };
}
