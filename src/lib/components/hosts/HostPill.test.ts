import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from 'svelte/server';

/** page.data the layout-load produces. `hosts.channels` is already resolved
 *  server-side to one instance per channel (spec §D4). */
const data = { hosts: { servers: [], channels: [] as { channel: string; serverId: string; healthy: boolean | null }[] } };
let admin = true;

vi.mock('$app/state', () => ({ page: { get data() { return data; } } }));
vi.mock('$lib/state/features/user.svelte', () => ({
  isAdmin: { get value() { return admin; } },
  invalidateHosts: async () => {},
}));
vi.mock('$lib/services/gateway.svelte', () => ({ wsConnect: () => {}, wsDisconnect: () => {} }));

const HostPill = (await import('./HostPill.svelte')).default;

function html(channels: typeof data.hosts.channels, isAdmin = true): string {
  data.hosts.channels = channels;
  admin = isAdmin;
  return render(HostPill, { props: {} }).body;
}

const DEV = { channel: 'dev', serverId: 'gw-dev', healthy: true };
const PRD = { channel: 'prd', serverId: 'gw-prd', healthy: true };

beforeEach(() => {
  data.hosts.channels = [];
  admin = true;
});

describe('HostPill — the BUILD picker', () => {
  it('two channels (MINION/PINONITE) → a DEV|PRD segmented control', () => {
    const out = html([DEV, PRD]);
    // role="group" is SegmentedControl's root — assert the VIEW rendered the
    // control, not merely that the state exposed two channels.
    expect(out).toContain('role="group"');
    expect(out).toContain('>DEV<');
    expect(out).toContain('>PRD<');
  });

  it('one channel (FACES) → NO control rendered, just the label', () => {
    const out = html([PRD]);
    expect(out).not.toContain('role="group"');
    expect(out).toContain('>PRD<');
    expect(out).not.toContain('>DEV<');
  });

  it('never names the gateway instance — only the channel', () => {
    const out = html([DEV, PRD]);
    expect(out).not.toContain('gw-dev');
    expect(out).not.toContain('gw-prd');
  });

  it('an unhealthy channel stays selectable and says so', () => {
    const out = html([DEV, { ...PRD, healthy: false }]);
    expect(out).toContain('role="group"');
    expect(out).not.toContain('disabled');
  });

  it('renders nothing for a non-admin — the org assignment decides', () => {
    // SSR still emits hydration comments; assert no markup of our own.
    const out = html([DEV, PRD], false);
    expect(out).not.toContain('role="group"');
    expect(out).not.toContain('<div');
    expect(out).not.toContain('DEV');
  });
});
