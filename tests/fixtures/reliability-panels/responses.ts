export function pluginSnapshot(from: number, to: number, label: string) {
  return {
    plugins: [
      {
        pluginId: 'synthetic-channel',
        name: `${label} messaging service`,
        origin: 'bundled',
        source: 'plugins/synthetic-channel',
        status: 'loaded',
        enabled: true,
        configEnabled: true,
        capabilities: {
          tools: 2,
          hooks: 1,
          channels: 1,
          providers: 0,
          gatewayMethods: 1,
          httpHandlers: 0,
          cliCommands: 0,
          services: 1,
          commands: 0,
          flowNodes: 0,
          flows: 0,
        },
        channelIds: ['synthetic-channel'],
        providerIds: [],
        toolNames: ['send', 'read'],
        telemetry: {
          totalEvents: 42,
          bySeverity: { info: 40, warn: 2 },
          errors: 0,
          lastActivityAt: to,
          lastError: null,
          topFailureModes: [],
        },
      },
    ],
    capturedAt: to,
    period: { start: from, end: to },
  };
}

export function insightsSnapshot(from: number, to: number, total: number) {
  return {
    insights: {
      window: { from, to },
      signalToNoise: { total, signal: total, noise: 0, noisePct: 0 },
      noiseTrend: [],
      categoryVolume: [{ category: 'tool', n: total, pct: 1 }],
      topClusters: [],
      healthRegressions: [],
      costOutliers: [],
      reconnectStorms: [],
      proposedActions: [],
      generatedAt: to,
    },
  };
}

export function architectureSnapshot(label: string) {
  const nodes = ['hub', 'gateway'].map((id, i) => ({
    id,
    name: `${label} ${id}`,
    kind: 'app',
    network: i ? 'netcup' : 'vercel',
    fn: 'app',
    x: i * 300,
    y: 0,
    icon: i ? 'Server' : 'Globe',
    endpoints: [],
    description: 'Synthetic component evidence',
    status: 'ok',
    statusDetail: 'Synthetic healthy response; no production probe.',
  }));
  return {
    nodes,
    edges: [{ source: 'hub', target: 'gateway', via: 'Synthetic WebSocket' }],
    c4: {
      nodes: nodes.map((n) => ({
        id: `c4:${n.id}`,
        name: n.name,
        level: 'context',
        parentId: null,
        description: n.description,
        technology: 'Synthetic fixture',
        icon: n.icon,
        sourceRefs: [],
        artefacts: [],
        reconStatus: 'verified',
        statusNodeId: n.id,
      })),
      relations: [
        {
          source: 'c4:hub',
          target: 'c4:gateway',
          label: 'Synthetic connection',
          technology: 'WebSocket',
          kind: 'runtime',
        },
      ],
      generatedFrom: 'Local synthetic response for actual production renderer',
    },
    checkedAt: Date.now(),
  };
}
