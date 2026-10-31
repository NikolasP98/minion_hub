/**
 * Spec 045 T037 / launch step 2a: every gateway method the browser calls,
 * classified with the gateway's own scope rules. Once the dashboard connects
 * with its own JWT, a non-platform-admin holds only `operator.read` +
 * `operator.write`, so a browser call that needs `operator.admin` must be either
 * owner-accepted in `PLATFORM_ADMIN_ONLY` or moved behind a hub server route.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env as publicEnv } from '$env/dynamic/public';
import { page } from '$app/state';
import { SECRETS_METHODS } from '$lib/types/secrets';
import { PLATFORM_ADMIN_ONLY, gatewayMethodAllowed } from './platform-admin-methods';

// ── Copied from the gateway: minion `src/gateway/server-core/server-methods.ts`
// (`authorizeGatewayMethod`, branch feat/entitlements-s4-gateway b4072205d84 —
// spec 045 A1). Re-copy when the gateway's lists change.
const READ_METHODS = new Set([
  'health', 'logs.tail', 'channels.status', 'status', 'usage.status', 'usage.cost',
  'tts.status', 'tts.providers', 'models.list', 'agents.list', 'agent.identity.get',
  'specialists.status', 'skills.status', 'tools.status', 'tools.inspect', 'voicewake.get',
  'sessions.list', 'sessions.preview', 'cron.list', 'cron.status', 'cron.runs',
  'system-presence', 'last-heartbeat', 'node.list', 'node.describe', 'chat.history',
  'config.get', 'talk.config', 'mesh.plan', 'mesh.status', 'memory.snapshot',
  'pi-agent.context-usage', 'pi-agent.session-stats', 'pi-agent.thinking.levels',
  'templates.list', 'templates.get', 'pi-agent.orchestrations.list',
  'pi-agent.orchestrations.get', 'pi-agent.subagents.list', 'events.list', 'events.get',
  'events.summary', 'events.timeline', 'events.stream', 'whoami', 'user.data.export',
  'myAgent.feedToday', 'myAgent.emailBody', 'myAgent.emailSummary',
  'myAgent.emailDraftReply', 'drones.capabilities', 'drones.probe', 'shells.get_outcome',
]); // prettier-ignore
const WRITE_METHODS = new Set([
  'send', 'agent', 'agent.wait', 'wake', 'talk.mode', 'tts.enable', 'tts.disable',
  'tts.convert', 'tts.setProvider', 'media.transcribe', 'voicewake.set', 'node.invoke',
  'chat.send', 'chat.abort', 'browser.request', 'mesh.plan.auto', 'mesh.run', 'mesh.retry',
  'agent.install', 'pi-agent.thinking.set', 'pi-agent.subagents.kill',
  'pi-agent.subagents.steer', 'pi-agent.spawn', 'pi-agent.orchestrate', 'auth.refresh',
  'workshop.join', 'workshop.leave', 'workshop.authority.claim', 'workshop.authority.release',
  'drones.execute', 'drones.cancel',
]); // prettier-ignore
const APPROVAL_METHODS = new Set([
  'exec.approval.request', 'exec.approval.waitDecision', 'exec.approval.resolve',
]); // prettier-ignore
const PAIRING_METHODS = new Set([
  'node.pair.request', 'node.pair.list', 'node.pair.approve', 'node.pair.reject',
  'node.pair.verify', 'device.pair.list', 'device.pair.approve', 'device.pair.reject',
  'device.token.rotate', 'device.token.revoke', 'node.rename',
]); // prettier-ignore

type Scope = 'read' | 'write' | 'approvals' | 'pairing' | 'admin';

/** The scope a call needs. Anything unlisted falls through to admin, as on the gateway. */
function requiredScope(method: string, args: string): Scope {
  if (APPROVAL_METHODS.has(method)) return 'approvals';
  if (PAIRING_METHODS.has(method)) return 'pairing';
  if (READ_METHODS.has(method)) return 'read';
  if (WRITE_METHODS.has(method)) return 'write';
  // A1 (spec 045 OQ3): a `sessions.patch` holding only `key` and `label` needs write.
  if (method === 'sessions.patch' && isLabelOnly(args)) return 'write';
  return 'admin';
}

/** `{ key, label }` object literal with no other field (`key: x` / `label: y` forms). */
function isLabelOnly(args: string): boolean {
  const literal = /^\{([^{}]*)\}/.exec(args.trim());
  if (!literal) return false;
  const fields = literal[1]
    .split(',')
    .map((part) => part.split(':')[0].trim())
    .filter(Boolean);
  return fields.length > 0 && fields.every((f) => f === 'key' || f === 'label');
}

/**
 * Admin methods the browser used to call that now go through a hub server
 * route holding the gateway credential. The browser must never call them.
 */
const SERVED_BY_HUB_ROUTE: Record<string, string> = {
  'agents.create': '/api/personal-agent/create', // T035a
};

/** Browser call sites whose method is not a literal; each is guarded by `sendRequest`. */
const DYNAMIC_CALL_SITES: Record<string, string> = {
  'src/lib/plugins/PluginIframe.svelte':
    'forwards a plugin iframe RPC (method chosen by the plugin)',
  'src/lib/components/users/ChannelLinking.svelte':
    'a channel plugin’s declared link submit method',
  'src/lib/components/settings/SecretsSection.svelte': 'SECRETS_METHODS constants, resolved below',
};

const ROOT = path.resolve('src');
function browserFiles(dir = ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'server' ? [] : browserFiles(full);
    if (!/\.(ts|svelte)$/.test(entry.name)) return [];
    if (/\.test\.ts$|\.server\.ts$|\+server\.ts$/.test(entry.name)) return [];
    return [full];
  });
}

interface CallSite {
  method: string;
  file: string;
  args: string;
}
function scan(): { calls: CallSite[]; dynamic: Set<string> } {
  const calls: CallSite[] = [];
  const dynamic = new Set<string>();
  const literal = /\b(?:sendRequest|request)(?:<[^>()]*>)?\(\s*['"`]([\w.-]+)['"`]\s*,?/g;
  const nonLiteral = /(?<!function )\bsendRequest(?:<[^>()]*>)?\(\s*([A-Za-z_$][\w$.]*)/g;
  for (const full of browserFiles()) {
    const file = path.relative(process.cwd(), full);
    const source = readFileSync(full, 'utf8');
    for (const m of source.matchAll(literal)) {
      calls.push({ method: m[1], file, args: source.slice(m.index + m[0].length, m.index + 400) });
    }
    for (const m of source.matchAll(nonLiteral)) {
      dynamic.add(file);
      const secret = /^SECRETS_METHODS\.(\w+)$/.exec(m[1]);
      if (secret) {
        const method = SECRETS_METHODS[secret[1] as keyof typeof SECRETS_METHODS];
        if (method) calls.push({ method, file, args: '' });
      }
    }
  }
  return { calls, dynamic };
}

const { calls, dynamic } = scan();

describe('browser gateway method inventory', () => {
  it('finds the dashboard’s calls (scanner sanity)', () => {
    const methods = new Set(calls.map((c) => c.method));
    for (const m of ['chat.send', 'config.patch', 'sessions.patch', 'agents.list', 'secrets.set'])
      expect(methods).toContain(m);
  });

  it('every browser call needing operator.admin is platform-admin-only or moved to the hub', () => {
    const unaccepted = calls
      .filter((c) => requiredScope(c.method, c.args) !== 'read')
      .filter((c) => requiredScope(c.method, c.args) !== 'write')
      .filter((c) => !PLATFORM_ADMIN_ONLY.has(c.method))
      .map((c) => `${c.method} (${c.file})`);
    expect(unaccepted).toEqual([]);
  });

  it('chat’s sessions.patch calls are label-only, which A1 opens to operator.write', () => {
    const patches = calls.filter((c) => c.method === 'sessions.patch');
    expect(patches.length).toBeGreaterThan(0);
    for (const call of patches)
      expect(requiredScope(call.method, call.args), call.file).toBe('write');
  });

  it('the browser never calls a method a hub route now serves', () => {
    const leaked = calls.filter((c) => c.method in SERVED_BY_HUB_ROUTE);
    expect(leaked.map((c) => `${c.method} (${c.file})`)).toEqual([]);
  });

  it('lists only methods that are called and really need admin', () => {
    const called = new Set(calls.map((c) => c.method));
    for (const method of PLATFORM_ADMIN_ONLY) {
      expect(called.has(method), `${method} is no longer called`).toBe(true);
      expect(requiredScope(method, ''), method).toBe('admin');
    }
  });

  it('knows every non-literal call site', () => {
    expect([...dynamic].sort()).toEqual(Object.keys(DYNAMIC_CALL_SITES).sort());
  });
});

describe('gatewayMethodAllowed', () => {
  afterEach(() => {
    delete publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN;
    page.data = {};
  });

  it('allows everything until the launch switch', () => {
    page.data = { user: { role: 'user' } };
    expect(gatewayMethodAllowed('config.patch')).toBe(true);
  });

  it('after the switch, refuses admin-only methods to everyone but a platform admin', () => {
    publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = 'false';
    page.data = { user: { role: 'user' } };
    expect(gatewayMethodAllowed('config.patch')).toBe(false);
    expect(gatewayMethodAllowed('chat.send')).toBe(true);
    page.data = { user: { role: 'admin' } };
    expect(gatewayMethodAllowed('config.patch')).toBe(true);
  });

  it('sendRequest says "your role can’t" without calling the gateway', async () => {
    publicEnv.PUBLIC_GATEWAY_BROWSER_SHARED_TOKEN = 'false';
    page.data = { user: { role: 'user' } };
    const rpc = await import('../gateway-rpc');
    const request = vi.fn();
    rpc.setClient({ request } as never);
    try {
      await expect(rpc.sendRequest('config.patch', {})).rejects.toThrow(/role can't/i);
      expect(request).not.toHaveBeenCalled();
    } finally {
      rpc.setClient(null);
    }
  }, 30_000); // the first lazy messages-chunk load is slow under vitest
});
