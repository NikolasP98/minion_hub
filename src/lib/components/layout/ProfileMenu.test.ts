import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

type Channel = { channel: 'dev' | 'prd'; serverId: string; healthy: boolean | null };

const data = {
  hosts: { servers: [], channels: [] as Channel[] },
};
let admin = true;

vi.mock('$app/state', () => ({
  page: {
    get data() {
      return data;
    },
  },
}));
vi.mock('$lib/state/features/user.svelte', () => ({
  isAdmin: {
    get value() {
      return admin;
    },
  },
  userState: {
    user: { id: 'user-1', email: 'admin@example.com', displayName: 'Admin', avatarUrl: null },
    role: 'admin',
  },
  logout: vi.fn(),
  invalidateHosts: async () => {},
}));
vi.mock('$lib/state/ui/locale.svelte', () => ({
  locale: { current: 'en', toggle: vi.fn() },
}));
vi.mock('$lib/services/gateway.svelte', () => ({
  wsConnect: vi.fn(),
  wsDisconnect: vi.fn(),
}));

const ProfileMenu = (await import('./ProfileMenu.svelte')).default;

const DEV: Channel = { channel: 'dev', serverId: 'gw-dev', healthy: true };
const PRD: Channel = { channel: 'prd', serverId: 'gw-prd', healthy: true };

function html(channels: Channel[], isAdmin = true): string {
  data.hosts.channels = channels;
  admin = isAdmin;
  return render(ProfileMenu).body;
}

beforeEach(() => {
  data.hosts.channels = [];
  admin = true;
});

describe('ProfileMenu build-channel row', () => {
  it('renders after Language for admins with two channels', () => {
    const out = html([DEV, PRD]);
    const language = out.indexOf('Language');
    const channel = out.indexOf('Build channel');

    expect(language).toBeGreaterThan(-1);
    expect(channel).toBeGreaterThan(language);
    expect(out).toContain('>DEV<');
    expect(out).not.toContain('gw-dev');
    expect(out).not.toContain('gw-prd');
  });

  it('keeps a one-channel org visibly pinned to PRD', () => {
    const out = html([PRD]);

    expect(out).toContain('Build channel');
    expect(out).toContain('>PRD<');
    expect(out).not.toContain('>DEV<');
  });

  it('does not expose gateway plumbing to non-admins', () => {
    const out = html([DEV, PRD], false);

    expect(out).not.toContain('Build channel');
    expect(out).not.toContain('>DEV<');
    expect(out).not.toContain('>PRD<');
  });
});
