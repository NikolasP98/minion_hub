// Spec 045 (gateway per-org credentials) — the admin-method gate. Imports only
// framework modules and the flag helper, so the `gateway-rpc` leaf can use it
// without an import cycle.
import { page } from '$app/state';
import { browserSharedTokenOff } from '$lib/gateway-browser-token';

/**
 * Gate key for RPCs a plugin chooses (iframe `forwardRpc`, a channel plugin's
 * link submit method). `plugins.*` is admin on the gateway and plugin-specific
 * methods fall through to admin, so every such call needs a platform admin.
 */
export const PLUGIN_RPC = '$PLUGIN_RPC';

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
  'reliability.activity',
  'reliability.events',
  'reliability.flow',
  'reliability.perf',
  'reliability.plugins',
  'reliability.summary',
  'reliability.timeline',
  'reliability.usage',
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
  // Plugin iframe RPCs and plugin-declared methods (gate key, not a method)
  PLUGIN_RPC,
  // Secrets
  'secrets.clear',
  'secrets.clear_scoped',
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

// TODO(handoff): spec 045 T037/T038 hide (not lock) every surface behind this list from
// anyone but a platform admin once switched: channel setup; the pages in ADMIN_ONLY_PAGES
// (reliability, kill switches, cloud/shells, flow editor, config, prompt builder, plugin
// pages, tool editor, session debug, workshop experiments) via canViewPath + the app
// layout; agent Files/Prompt tabs, agent settings panel, tool drag and skill toggles,
// dream activity, secrets, the session-title drone and flow-trigger re-registration.
// Left ungated: `skills.update` (agent-skills `toggleGlobalSkill` has no UI caller),
// `drones.list` / `flows.*` / `shells.*` / `tools.*` / `reliability.*` (reachable only from
// the hidden pages above), `playground.complete` / `models.setEnabled` (workshop
// experiments, hidden). A hidden page's own links are removed where found (workshop nav,
// leaderboard back-link, agent dashboard, builder cards); any link missed lands on an
// empty page. Move each admin RPC to a hub route (spec 042) and drop it from this list.
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

/** Reject with the localized "your role can't" (the messages chunk loads lazily, off the shell bundle). */
export async function refuseForRole(): Promise<never> {
  const m = await import('$lib/paraglide/messages');
  throw new GatewayRoleError(m.gateway_roleCantAction());
}

/**
 * Pages whose whole purpose is behind one admin-only method (spec 045 T038).
 * `canViewPath` (sidebar, topbar, palette, hotkeys, assistant) and the app
 * layout both read this, so the nav entry and the URL go dark together.
 */
const ADMIN_ONLY_PAGES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/reliability(\/|$)/, 'reliability.summary'],
  [/^\/killswitches(\/|$)/, 'killswitch.list'],
  [/^\/(cloud|shells)(\/|$)/, 'shells.list'],
  [/^\/flow-editor(\/|$)/, 'flows.templates.list'],
  [/^\/config(\/|$)/, 'config.schema'],
  [/^\/prompt(\/|$)/, 'prompt.sections.list'],
  [/^\/plugins\/[^/]/, PLUGIN_RPC],
  [/^\/tools\/[^/]/, 'tools.update'],
  [/^\/sessions\/[^/]+\/debug(\/|$)/, 'debug.setSteppedBuild'],
  [/^\/agents\/workshop\/(compare|groupchat)(\/|$)/, 'playground.complete'],
];

/** The page at this canonical path exists only for gateway admins and this viewer is not one. */
export function adminOnlyPageHidden(canonicalPath: string): boolean {
  const path = canonicalPath.split(/[?#]/, 1)[0];
  return ADMIN_ONLY_PAGES.some(([re, method]) => re.test(path) && !gatewayMethodAllowed(method));
}
