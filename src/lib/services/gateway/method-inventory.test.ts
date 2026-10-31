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
import { PLATFORM_ADMIN_ONLY, PLUGIN_RPC, gatewayMethodAllowed } from './platform-admin-methods';

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

/** Gateway admin-scope prefixes and fallthrough names, copied with the sets above. */
const ADMIN_METHOD_PREFIXES = ['exec.approvals.', 'admin.impersonate', 'hub.', 'debug.', 'plugins.', 'killswitch.']; // prettier-ignore
const ADMIN_FALLTHROUGH_NAMESPACES = ['config', 'wizard', 'update', 'channels', 'agents', 'skills', 'cron', 'sessions']; // prettier-ignore

/**
 * Namespaces a gateway method can live in. Any dotted string in browser code
 * under one of these is treated as a possible RPC and must be classified.
 */
const NAMESPACES = new Set(
  [
    ...[...READ_METHODS, ...WRITE_METHODS, ...APPROVAL_METHODS, ...PAIRING_METHODS],
    ...ADMIN_METHOD_PREFIXES,
    ...ADMIN_FALLTHROUGH_NAMESPACES,
    ...PLATFORM_ADMIN_ONLY,
  ]
    .filter((name) => /^[A-Za-z][\w-]*\./.test(name) || ADMIN_FALLTHROUGH_NAMESPACES.includes(name))
    .map((name) => name.split('.')[0]),
);

/**
 * Admin methods the browser used to call that now go through a hub server
 * route holding the gateway credential. The browser must never call them.
 */
const SERVED_BY_HUB_ROUTE: Record<string, string> = {
  'agents.create': '/api/personal-agent/create', // T035a
};

/** Dotted strings under a gateway namespace that are NOT RPCs, each with why. */
const NOT_RPC: Record<string, string> = {
  // Gateway event names (server → browser frames), never requested
  'agent.llm.usage': 'event name',
  'channels.status.changed': 'event name',
  'channels.status.updated': 'event name',
  'channels.whatsapp.pairFailed': 'event name',
  'channels.whatsapp.paired': 'event name',
  'channels.whatsapp.qr': 'event name',
  'chat.event': 'event name',
  'debug.step': 'event name',
  'exec.error': 'reliability event type',
  'exec.ok': 'reliability event type',
  'flows.run.event': 'event name',
  'memory.node_created': 'event name',
  'memory.node_deleted': 'event name',
  'memory.node_updated': 'event name',
  'memory.recall': 'event name',
  'pi-agent.orchestration-progress': 'event name',
  'pi-agent.run-end': 'event name',
  'pi-agent.run-start': 'event name',
  'pi-agent.subagent-completed': 'event name',
  'pi-agent.subagent-spawned': 'event name',
  'pi-agent.tool-call': 'event name',
  'prompt.sections.changed': 'event name',
  'prompt.sections.preview.event': 'event name',
  'update.applied': 'event name',
  'update.available': 'event name',
  'update.migrating': 'event name',
  'update.notify': 'event name',
  'update.progress': 'event name',
  // Hub-local names
  'agent.json': 'marketplace file name',
  'agent.notice': 'notification kind',
  'agent.report': 'notification kind',
  'agent.report.ready': 'notification kind',
  'agent.user_notice': 'notification kind',
  'agents.publish': 'hub access capability key',
  'agents.view': 'hub access capability key',
  'channels.view': 'hub access capability key',
  'config.editor': 'hub access capability key',
  'flows.view': 'hub access capability key',
  'reliability.monitor': 'hub access capability key',
  'agents.defaults': 'gateway config path (agent settings schema)',
  'agents.list.0': 'gateway config path (agent settings schema)',
  'tools.allow': 'gateway config path (agent settings schema)',
  'tools.byProvider': 'gateway config path (agent settings schema)',
  'tools.deny': 'gateway config path (agent settings schema)',
  'tools.elevated': 'gateway config path (agent settings schema)',
  'tools.exec': 'gateway config path (agent settings schema)',
  'tools.profile': 'gateway config path (agent settings schema)',
  'chat.abort_failed': 'hub diagnostic event',
  'chat.cancel': 'hub chat state transition',
  'chat.commit': 'hub chat state transition',
  'chat.guard_timeout': 'hub diagnostic event',
  'channels.send': 'flow diagram label text',
  'hub.artifact.context.get': 'artifact iframe RPC answered by the hub API, never forwarded',
  'hub.navigate': 'assistant tool name (runs in the hub)',
  'hub.pages': 'assistant tool name (runs in the hub)',
  'plugins.controlCenter': 'plugin UI slot id',
  'plugins.users.list': 'plugin RPC answered by the hub API before forwarding',
};

/** Dotted template strings (`ns.${…}`) that are not RPCs, by file and prefix. */
const NOT_RPC_TEMPLATES: Record<string, string> = {
  'src/lib/utils/agent-settings-schema.ts agents.': 'gateway config path',
  'src/lib/components/agents/AgentSettingsPanel.svelte agents.': 'gateway config path',
  'src/routes/(app)/home/settings/+page.svelte agents.': 'gateway config path',
  'src/lib/plugins/PluginIframe.svelte plugins.': 'error message text',
};

/** Call sites whose method is not a literal, with how each is gated. */
const DYNAMIC_CALL_SITES: Record<string, string> = {
  'src/lib/plugins/PluginIframe.svelte': 'plugin iframe RPC, gated as PLUGIN_RPC',
  'src/lib/components/users/ChannelLinking.svelte': 'plugin link submit, gated as PLUGIN_RPC',
  'src/lib/components/settings/SecretsSection.svelte':
    'SECRETS_METHODS constants; their strings are swept in src/lib/types/secrets.ts',
  'src/lib/state/reliability/owned-resource.svelte.ts':
    'loader for reliability.* (strings swept in reliability.svelte.ts); guarded transport',
  'src/lib/services/gateway-rpc.ts': 'sendRequest itself (gated)',
  'src/lib/services/gateway.svelte.ts': 'guardedRequest itself (gated)',
  'src/lib/services/gateway/session-bootstrap.ts':
    'read(method) wrapper; its strings are swept here; guarded transport',
  // Not gateway calls: a local `request` that is something else.
  'src/lib/components/pos/plan-open-persistence.ts': 'Web Locks API request(name, …)',
  'src/lib/components/scheduling/collection-mutations.svelte.ts': 'HTTP request(signal) callback',
  'src/routes/(app)/scheduling/settings/PageBody.svelte': 'HTTP request(signal) callback',
};

const ROOT = path.resolve('src');
function browserFiles(dir = ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory())
      return ['server', 'paraglide', '__fixtures__'].includes(entry.name) ? [] : browserFiles(full);
    if (!/\.(ts|svelte)$/.test(entry.name)) return [];
    if (/\.test\.ts$|\.server\.ts$|\+server\.ts$/.test(entry.name)) return [];
    return [full];
  });
}

/** Drop comments so a method named in prose is not counted (URLs keep their `//`). */
function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

interface CallSite {
  method: string;
  file: string;
  args: string;
}
interface Sweep {
  /** Literal first-argument calls, kept for the `sessions.patch` label-only check. */
  calls: CallSite[];
  /** Every dotted string under a gateway namespace, wherever it appears. */
  strings: Array<{ value: string; file: string }>;
  templates: Array<{ prefix: string; file: string }>;
  dynamic: Set<string>;
}

export function sweepSource(file: string, raw: string, into: Sweep): void {
  const source = stripComments(raw);
  for (const m of source.matchAll(
    /\b(?:sendRequest|request)(?:<[^>()]*>)?\(\s*['"`]([\w.-]+)['"`]\s*,?/g,
  )) {
    into.calls.push({
      method: m[1],
      file,
      args: source.slice(m.index + m[0].length, m.index + 400),
    });
  }
  for (const m of source.matchAll(/(['"`])([A-Za-z][\w-]*(?:\.[\w-]+)+)\1/g)) {
    if (NAMESPACES.has(m[2].split('.')[0])) into.strings.push({ value: m[2], file });
  }
  for (const m of source.matchAll(/`([A-Za-z][\w-]*)\.[^`]*?\$\{/g)) {
    if (NAMESPACES.has(m[1])) into.templates.push({ prefix: `${m[1]}.`, file });
  }
  if (/(?<!function )\b(?:sendRequest|request)(?:<[^>()]*>)?\(\s*(?!['"`)])[A-Za-z_$]/.test(source))
    into.dynamic.add(file);
}

/** Every reason the sweep is not accepted; empty means the owner's list is complete. */
export function violations(sweep: Sweep): string[] {
  const out = new Set<string>();
  for (const { value, file } of sweep.strings) {
    if (READ_METHODS.has(value) || WRITE_METHODS.has(value) || value === 'sessions.patch') continue;
    if (value in SERVED_BY_HUB_ROUTE)
      out.add(`${value} is served by ${SERVED_BY_HUB_ROUTE[value]} (${file})`);
    else if (!PLATFORM_ADMIN_ONLY.has(value) && !(value in NOT_RPC))
      out.add(`${value} needs operator.admin but is not PLATFORM_ADMIN_ONLY (${file})`);
  }
  // A literal call is classified by the gateway's own rules, whatever the string
  // allowlists say (re-audit R1: `NOT_RPC` holds real methods like `channels.send`).
  for (const { method, file, args } of sweep.calls) {
    const scope = requiredScope(method, args);
    if (scope !== 'read' && scope !== 'write' && !PLATFORM_ADMIN_ONLY.has(method))
      out.add(`${method} needs operator.${scope} but is not PLATFORM_ADMIN_ONLY (${file})`);
  }
  for (const { prefix, file } of sweep.templates)
    if (!(`${file} ${prefix}` in NOT_RPC_TEMPLATES)) out.add(`template ${prefix}\${…} (${file})`);
  for (const file of sweep.dynamic)
    if (!(file in DYNAMIC_CALL_SITES)) out.add(`non-literal gateway call (${file})`);
  return [...out];
}

function emptySweep(): Sweep {
  return { calls: [], strings: [], templates: [], dynamic: new Set() };
}
const tree = emptySweep();
for (const full of browserFiles()) sweepSource(path.relative(process.cwd(), full), readFileSync(full, 'utf8'), tree); // prettier-ignore

describe('the sweep catches what the A3 audit found the call-shape scan missed', () => {
  const probe = (file: string, source: string) => {
    const sweep = emptySweep();
    sweepSource(file, source, sweep);
    return violations(sweep);
  };
  it('a template-literal method', () => {
    expect(probe('src/lib/x.ts', 'sendRequest(`update.${step}`)')).toEqual([
      'template update.${…} (src/lib/x.ts)',
    ]);
  });
  it('a wrapper taking the method as a later argument', () => {
    expect(probe('src/lib/x.ts', "rel.load(owner, 'agents.delete', {})")).toEqual([
      'agents.delete needs operator.admin but is not PLATFORM_ADMIN_ONLY (src/lib/x.ts)',
    ]);
  });
  it('a literal call the string allowlists would excuse, or outside every namespace', () => {
    expect(probe('src/lib/x.ts', "sendRequest('channels.send', {})")).toContain(
      'channels.send needs operator.admin but is not PLATFORM_ADMIN_ONLY (src/lib/x.ts)',
    );
    expect(probe('src/lib/x.ts', "sendRequest('restart')")).toContain(
      'restart needs operator.admin but is not PLATFORM_ADMIN_ONLY (src/lib/x.ts)',
    );
    expect(probe('src/lib/x.ts', "sendRequest('sessions.patch', { key, model })")).toContain(
      'sessions.patch needs operator.admin but is not PLATFORM_ADMIN_ONLY (src/lib/x.ts)',
    );
    expect(probe('src/lib/x.ts', "sendRequest('chat.history', {})")).toEqual([]);
  });
  it('.request(m) with a variable', () => {
    expect(probe('src/lib/x.ts', 'client.request(m, {})')).toEqual([
      'non-literal gateway call (src/lib/x.ts)',
    ]);
  });
  it('a ternary inside an allowlisted dynamic site', () => {
    expect(
      probe('src/lib/plugins/PluginIframe.svelte', "sendRequest(on ? 'cron.remove' : 'health')"),
    ).toEqual(['cron.remove needs operator.admin but is not PLATFORM_ADMIN_ONLY (src/lib/plugins/PluginIframe.svelte)']); // prettier-ignore
  });
  it('accepts read/write methods and listed admin methods', () => {
    expect(probe('src/lib/x.ts', "f('chat.send'); g('config.patch'); h('agents.list')")).toEqual(
      [],
    );
  });
});

describe('browser gateway method inventory', () => {
  it('finds the dashboard’s calls (scanner sanity)', () => {
    const methods = new Set(tree.strings.map((c) => c.value));
    for (const m of [
      'chat.send',
      'config.patch',
      'sessions.patch',
      'reliability.summary',
      'secrets.clear',
    ])
      expect(methods).toContain(m);
  });

  it('every gateway-looking string is classified: read, write, admin-listed or not an RPC', () => {
    expect(violations(tree)).toEqual([]);
  });

  it('chat’s sessions.patch calls are label-only, which A1 opens to operator.write', () => {
    const patches = tree.calls.filter((c) => c.method === 'sessions.patch');
    expect(patches.length).toBeGreaterThan(0);
    for (const call of patches)
      expect(requiredScope(call.method, call.args), call.file).toBe('write');
  });

  it('lists only methods that are still referenced and really need admin', () => {
    const referenced = new Set(tree.strings.map((c) => c.value));
    for (const method of PLATFORM_ADMIN_ONLY) {
      if (method === PLUGIN_RPC) continue;
      expect(referenced.has(method), `${method} is no longer referenced`).toBe(true);
      expect(requiredScope(method, ''), method).toBe('admin');
    }
    for (const value of Object.keys(NOT_RPC))
      expect(referenced.has(value), `NOT_RPC ${value} is stale`).toBe(true);
  });

  it('every plugin-chosen call is gated as PLUGIN_RPC', () => {
    for (const file of [
      'src/lib/plugins/PluginIframe.svelte',
      'src/lib/components/users/ChannelLinking.svelte',
    ])
      expect(readFileSync(file, 'utf8'), file).toMatch(/sendRequest\([^)]*PLUGIN_RPC\)/);
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
