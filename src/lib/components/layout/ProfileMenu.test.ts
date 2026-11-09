import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { inactiveSimulation, type RoleSimulationState } from '$lib/role-simulation';

type Channel = { channel: 'dev' | 'prd'; serverId: string; healthy: boolean | null };

const data: {
  hosts: { servers: []; channels: Channel[] };
  env?: { backend?: 'dev' | 'prd'; local?: boolean };
  roleSimulation?: RoleSimulationState;
} = {
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
  data.env = undefined;
  data.roleSimulation = undefined;
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

describe('ProfileMenu keeps QA account changes separate from simulation', () => {
  it('does not offer account switching in the avatar menu on DEV', () => {
    data.env = { backend: 'dev', local: true };
    const out = html([]);

    expect(out).not.toContain('Switch user');
    expect(out).not.toContain('Switch QA account');
    expect(out).not.toContain('/api/dev/switch-user');
  });

  it('hides "Switch user…" when the backend is prd', () => {
    data.env = { backend: 'prd', local: true };
    const out = html([]);

    expect(out).not.toContain('Switch user');
  });

  it('hides "Switch user…" when env is unset (deployed environments)', () => {
    data.env = undefined;
    data.roleSimulation = undefined;
    const out = html([]);

    expect(out).not.toContain('Switch user');
  });
});

describe('Settings entry', () => {
  it.each([true, false])('offers personal Settings for admin=%s', (isAdmin) => {
    const out = html([], isAdmin);
    expect(out).toContain('href="/settings/appearance"');
    const account = out.indexOf('href="/account"');
    const settings = out.indexOf('href="/settings/appearance"');
    expect(settings).toBeGreaterThan(account);
    expect(out.indexOf('Language')).toBeGreaterThan(settings);
  });
});

describe('organization simulation menu item', () => {
  it('offers one entry rather than expanding the role catalog in the avatar menu', () => {
    data.roleSimulation = {
      ...inactiveSimulation(),
      eligible: true,
      roles: [{ key: 'custom-secret', name: 'Custom catalog role', selectable: true }],
    };
    const out = html([]);
    expect(out.match(/Simulate a role…/g)).toHaveLength(1);
    expect(out).not.toContain('Custom catalog role');
    expect(out).not.toContain('Finish simulation');
  });
  it('keeps Finish visible when effective role has no management permissions', () => {
    data.roleSimulation = {
      ...inactiveSimulation(),
      active: true,
      invalid: true,
      eligible: false,
      roleKey: 'custom-restricted',
      roleName: 'Restricted role',
    };
    const out = html([], false);
    expect(out).toContain('Finish simulation');
    expect(out).toContain('Restricted role');
    expect(out).toContain('simulation-finish');
    expect(out).not.toContain('Simulate a role…');
  });
  it('does not offer simulation merely because the platform store calls someone admin', () => {
    expect(html([], true)).not.toContain('Simulate a role');
  });
});
