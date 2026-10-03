// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import InsightsPanel from './InsightsPanel.svelte';
import PluginHealthPanel from './PluginHealthPanel.svelte';
import {
  publishGatewaySessionOwner,
  retireGatewaySessionOwner,
} from '$lib/services/gateway/session-owner.svelte';
import {
  pushReliabilityEvent,
  reliability,
  resetReliability,
  setReliabilityOwner,
} from '$lib/state/reliability/reliability.svelte';

function plugin(from: number, to: number, totalEvents = 5) {
  return {
    plugins: [
      {
        pluginId: 'alpha',
        name: 'Alpha',
        origin: 'bundled',
        source: 'plugins/alpha',
        status: 'loaded',
        enabled: true,
        configEnabled: true,
        capabilities: {
          tools: 0,
          hooks: 0,
          channels: 0,
          providers: 0,
          gatewayMethods: 0,
          httpHandlers: 0,
          cliCommands: 0,
          services: 0,
          commands: 0,
          flowNodes: 0,
          flows: 0,
        },
        channelIds: [],
        providerIds: [],
        toolNames: [],
        telemetry: {
          totalEvents,
          bySeverity: { info: totalEvents },
          errors: 0,
          lastActivityAt: null,
          lastError: null,
          topFailureModes: [],
        },
      },
    ],
    capturedAt: to,
    period: { start: from, end: to },
  };
}

function insights(from: number, to: number, total = 0) {
  return {
    insights: {
      window: { from, to },
      signalToNoise: { total, signal: total, noise: 0, noisePct: 0 },
      noiseTrend: [],
      categoryVolume: total ? [{ category: 'tool', n: total, pct: 1 }] : [],
      topClusters: [],
      healthRegressions: [],
      costOutliers: [],
      reconnectStorms: [],
      proposedActions: [],
      generatedAt: to,
    },
  };
}

afterEach(() => {
  cleanup();
  retireGatewaySessionOwner();
  resetReliability();
  vi.unstubAllGlobals();
});

describe('mounted production reliability panels', () => {
  it('renders plugin failure with owned retry, then keeps live activity out of aggregate counts', async () => {
    const now = Date.now();
    let fail = true;
    const request = vi.fn(async () => {
      if (fail) throw new Error('private transport detail');
      return plugin(now - 1000, now + 1000);
    });
    const owner = publishGatewaySessionOwner({
      actorId: 'actor',
      orgId: 'org',
      hostId: 'host',
      hostUrl: 'wss://gateway.test',
      methods: ['reliability.plugins'],
      current: () => true,
      request,
    });
    const view = render(PluginHealthPanel, {
      serverId: 'host',
      actorId: 'actor',
      orgId: 'org',
      hostUrl: 'wss://gateway.test',
      from: now - 1000,
      to: now + 1000,
    });
    setReliabilityOwner(owner);
    await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
    expect(view.container.textContent).not.toContain('private transport detail');
    fail = false;
    await fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(view.getByText('Alpha')).toBeTruthy());
    pushReliabilityEvent(
      {
        timestamp: now,
        category: 'tool',
        severity: 'info',
        event: 'alpha.completed',
        message: 'Synthetic activity',
        metadata: { pluginId: 'alpha' },
      },
      owner,
    );
    expect(owner.current()).toBe(true);
    expect(reliability.recentEvents).toHaveLength(1);
    await tick();
    await waitFor(() => expect(view.getByText(/live/i)).toBeTruthy());
    expect(view.container.textContent).toContain('5');
    expect(view.container.textContent).not.toContain('6 events');
  });

  it('renders an unadvertised plugin method as unsupported without a transport call', async () => {
    const request = vi.fn();
    publishGatewaySessionOwner({
      actorId: 'actor',
      orgId: 'org',
      hostId: 'host',
      hostUrl: 'wss://gateway.test',
      methods: [],
      current: () => true,
      request,
    });
    const view = render(PluginHealthPanel, {
      serverId: 'host',
      actorId: 'actor',
      orgId: 'org',
      hostUrl: 'wss://gateway.test',
      from: 10,
      to: 20,
    });
    await waitFor(() => expect(view.getByText(/does not provide this data/i)).toBeTruthy());
    expect(view.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it('clears an old insight range on failure and repairs the current range with Retry', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        call++;
        if (call === 2) throw new Error('network');
        const url = new URL(String(input), 'https://hub.test');
        const from = Number(url.searchParams.get('from'));
        const to = Number(url.searchParams.get('to'));
        return new Response(JSON.stringify(insights(from, to, call === 1 ? 7 : 3)), {
          status: 200,
        });
      }),
    );
    const view = render(InsightsPanel, {
      serverId: 'host',
      actorId: 'actor',
      orgId: 'org',
      from: 10,
      to: 20,
    });
    await waitFor(() => expect(view.container.textContent).toContain('7'));
    // Move the range and repair that current-range failure through the panel's
    // owned Retry button.
    await view.rerender({ serverId: 'host', actorId: 'actor', orgId: 'org', from: 30, to: 40 });
    await waitFor(() => expect(view.getByRole('alert')).toBeTruthy());
    expect(view.container.textContent).not.toContain('7');
    await fireEvent.click(view.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(view.container.textContent).toContain('3'));
    expect(view.queryByRole('alert')).toBeNull();
  });
});
