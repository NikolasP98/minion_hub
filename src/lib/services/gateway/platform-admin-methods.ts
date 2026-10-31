// Spec 045 (gateway per-org credentials) — the admin-method gate. Imports only
// framework modules and the flag helper, so the `gateway-rpc` leaf can use it
// without an import cycle.
import { page } from '$app/state';
import { browserSharedTokenOff } from '$lib/gateway-browser-token';

/**
 * Gateway methods the dashboard calls that need `operator.admin`, which only a
 * platform admin's JWT carries (spec 045 I4). Owner-accepted at launch step 2a;
 * each moves to a hub server route checked against org RBAC in spec 042.
 * `gateway/method-inventory.test.ts` fails when a browser call needs admin and
 * is missing here, or when an entry here is no longer called.
 */
export const PLATFORM_ADMIN_ONLY: ReadonlySet<string> = new Set([
  // Agents: workspace files, skills
  'agents.files.get',
  'agents.files.list',
  'agents.files.set',
  'agents.skills.set',
  'skills.update',
  // Channels: setup, pairing, logout, plugin list
  'channels.discord.validateToken',
  'channels.logout',
  'channels.plugins.list',
  'channels.telegram.validateToken',
  'channels.whatsapp.pair',
  // Gateway config (config.get is a read method)
  'config.patch',
  'config.schema',
  // Debug, kill switches, reliability
  'debug.setSteppedBuild',
  'debug.skipAll',
  'debug.stepContinue',
  'killswitch.list',
  'killswitch.set',
  'reliability.plugins',
  'sessions.usage',
  // Dream, drones
  'dream.history',
  'drones.list',
  'drones.session-title',
  // Flows
  'flows.nodes.list',
  'flows.run',
  'flows.schedule.register',
  'flows.schedule.unregister',
  'flows.templates.list',
  'flows.trigger.register',
  'flows.trigger.unregister',
  // Models, playground
  'models.setEnabled',
  'playground.complete',
  // Prompt sections
  'prompt.preview',
  'prompt.sections.delete',
  'prompt.sections.get',
  'prompt.sections.list',
  'prompt.sections.overrides.get',
  'prompt.sections.overrides.set',
  'prompt.sections.preview',
  'prompt.sections.preview.stream',
  'prompt.sections.prose.read',
  'prompt.sections.prose.write',
  'prompt.sections.upsert',
  'prompt.sections.usage',
  'prompt.sections.workspaceFiles.list',
  // Secrets
  'secrets.list',
  'secrets.probe',
  'secrets.probe_scoped',
  'secrets.set',
  'secrets.set_scoped',
  // Cloud workspace shells
  'shells.access',
  'shells.archive',
  'shells.backup_now',
  'shells.destroy',
  'shells.get',
  'shells.list',
  'shells.provision',
  'shells.quota',
  'shells.restart',
  // Tools
  'tools.custom.run',
  'tools.reload',
  'tools.update',
]);

function isPlatformAdmin(): boolean {
  return (page.data as { user?: { role?: unknown } } | undefined)?.user?.role === 'admin';
}

/**
 * Whether this viewer's gateway credential can call `method`. Always true until
 * the launch switch: today's token socket carries admin, so gating earlier would
 * hide controls that still work.
 */
export function gatewayMethodAllowed(method: string): boolean {
  return !browserSharedTokenOff() || !PLATFORM_ADMIN_ONLY.has(method) || isPlatformAdmin();
}

/** A gateway call this viewer's role cannot make; `message` is the localized "your role can't". */
export class GatewayRoleError extends Error {
  readonly code = 'gateway_role_forbidden';
}
