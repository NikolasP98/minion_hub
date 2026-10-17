/**
 * Context engineering for the floating assistant.
 *
 * The agent runs on the gateway and only ever receives message TEXT (there is no
 * structured context field on chat.send). So we give it situational awareness the
 * same way the voice-call path does: by prepending a compact context envelope to
 * the message. The clean user text is what shows in the transcript (see
 * sendAssistantTurn) — this envelope is for the model only.
 *
 * Two jobs:
 *  1. Tell the agent WHERE the user is and what's focused (route + params).
 *  2. Tell the agent HOW to act for the user: emit in-app markdown links
 *     `[label](/path)` — they render as clickable navigation (MarkdownMessage
 *     intercepts internal hrefs → SvelteKit goto), so a link IS the "navigate on
 *     the user's behalf, with confirmation" affordance (the click confirms).
 */

import { page } from '$app/state';
import {
  HUB_ROUTE_MAP,
  HUB_NOTABLE_PARAMS,
} from '../../../routes/api/gateway/_shared/hub-route-map';
import { getTools } from '$lib/assistant/model-context';
import { getPageContext } from '$lib/assistant/page-context';
import { visiblePages } from '$lib/assistant/site-map';
import { FORM_CATALOG } from '$lib/assistant/catalog';
import { uiToolsBriefing } from '$lib/assistant/briefing';
import { canViewPath } from '$lib/access/can.svelte';
import { languageTag } from '$lib/paraglide/runtime';
import { CONTEXT_MANIFESTS, MANIFEST_IDS, type ManifestId } from '$lib/assistant/turn-router';

function describeRoute(pathname: string): string {
  for (const [prefix, desc] of HUB_ROUTE_MAP) {
    if (prefix === '/' ? pathname === '/' : pathname.startsWith(prefix)) return desc;
  }
  return 'A page in the dashboard.';
}

/** A short "what's focused" clause from dynamic id segments + notable query params. */
function describeFocus(pathname: string, params: URLSearchParams): string {
  const bits: string[] = [];

  // A trailing id segment after a known collection (e.g. /crm/<id>) = a focused record.
  const seg = pathname.split('/').filter(Boolean);
  if (seg[0] === 'crm' && seg[1] && seg[1] !== 'customers') {
    bits.push(`focused on customer id ${seg[1]} (link as /crm/${seg[1]})`);
  }

  for (const k of HUB_NOTABLE_PARAMS) {
    const v = params.get(k);
    if (!v) continue;
    if (k === 'contact') bits.push(`filtered to customer id ${v} (link as /crm/${v})`);
    else if (k === 'new') bits.push('a create/new form is open');
    else bits.push(`${k}=${v}`);
  }

  return bits.join('; ');
}

function activeOrg(): { name: string | null; id: string | null; multi: boolean } {
  const data = page.data as
    | { organizations?: Array<{ id: string; name?: string }>; activeOrgId?: string | null }
    | undefined;
  const orgs = data?.organizations ?? [];
  const id = data?.activeOrgId ?? null;
  const name = id ? (orgs.find((o) => o.id === id)?.name ?? null) : null;
  return { name, id, multi: orgs.length > 1 };
}

/** Static inject prose, by manifest id (the dynamic sections are built inline). */
const INJECT = new Map(
  CONTEXT_MANIFESTS.filter((m) => m.inject).map((m) => [m.id, m.inject as string]),
);

/**
 * Build the context envelope prepended to the user's message (model-only).
 * Returns '' when there's nothing useful to add (the agent still works plainly).
 *
 * `loaded` is the set of context manifests the JEV turn router decided this turn
 * needs (see `$lib/assistant/turn-router`). Omit it — or pass every id, which is
 * what a null decision and `shadow` mode both produce — to get the full envelope
 * this function has always built. The core (where the user is, what's focused,
 * the org id, the link conventions, the UI-tool protocol and the closing line) is
 * never gated: it is small, and it is what keeps the agent oriented at all.
 */
export function buildAssistantContext(
  loaded: ReadonlySet<ManifestId> = new Set(MANIFEST_IDS),
): string {
  const pathname = page.url?.pathname ?? '/';
  const params = page.url?.searchParams ?? new URLSearchParams();

  const org = activeOrg();
  const focus = describeFocus(pathname, params);
  // The sandbox is the one page whose tools are page-scoped, so the model has
  // no standing knowledge of them. One core line points at the entry tool; the
  // authoring protocol itself is the gated `sandbox` manifest below.
  const inSandbox = pathname === '/sandbox' || pathname.startsWith('/sandbox/');

  const lines = [
    `[In-app assistant context — the user is in the Minion dashboard${org.name ? ` for ${org.name}` : ''}.`,
    `Current page: ${pathname} — ${describeRoute(pathname)}`,
    focus ? `Focus: ${focus}.` : '',
    // Only when the user belongs to >1 org: hand the active org id to data
    // tools (crm_insight) so they scope to what's on screen, not the default org.
    org.multi && org.id ? `active_org_id: ${org.id} (pass to data tools as orgId).` : '',
    loaded.has('brain')
      ? `For organization knowledge questions, call brains_list with the active orgId (when present), ` +
        `select that organization's Master Brain, then call brain_search with the same orgId. Never ` +
        `guess or reuse a brainId from another organization. Use the Master Brain for semantic or ` +
        `historical questions across messages and business sources; use the dedicated module query ` +
        `tools when the user needs an exact current metric or record.`
      : '',
    loaded.has('changelog') ? (INJECT.get('changelog') ?? '') : '',
    inSandbox
      ? 'You are in the Sandbox: the canvas map below is the board; build, change or arrange ' +
        'visuals with the sandbox.* tools.'
      : '',
    // Whatever the mounted page says about itself (the sandbox's canvas map).
    getPageContext(),
    // Gated twice on purpose: the noul/mode gate decides the turn needs it, and
    // the route decides it is relevant at all. `record_action` always wins its
    // own manifest (turn-router), so without the route check this ~1.1 KB would
    // ride along on every create/edit turn anywhere in the app.
    inSandbox && loaded.has('sandbox') ? (INJECT.get('sandbox') ?? '') : '',
    // Site-wide data access: the agent has read tools over the whole org DB, so it
    // should answer from live data on ANY page rather than "I can't see the screen".
    // Gated on data OR forms: a record_action turn (e.g. void a ticket, close a
    // shift) has no catalog form and needs this paragraph to know its write tools
    // exist at all — see audit D6.
    loaded.has('data') || loaded.has('forms')
      ? `You can read this org's live data — customers, invoices, payments, sales, ` +
        `bookings, support tickets, memberships, projects, messages — with your tools ` +
        `(crm_insight for top/recent customers, crm_query for any other sorting/grouping/ ` +
        `date-range/percentage question, crm_search for a specific named person, ` +
        `search_crm_conversations for what customers said about a topic across chat ` +
        `history, crm_conversation_themes for pain-point/intent/over-explaining census ` +
        `questions). When the ` +
        `user asks about anything on this or any page, look it up and answer with specifics; ` +
        `don't say you can't see the page.`
      : '',
    `To take the user somewhere or cite evidence, write in-app markdown links [label](/path). ` +
      `They render as clickable navigation — a click is the user's confirmation. ` +
      `Always link a customer's name to /crm/{id}, and back up any figure with a link to the ` +
      `filtered view that proves it (e.g. [3 invoices](/finances/invoices?contact={id})).`,
    // The UI-tool protocol and intent rules are core (always sent); the page
    // list (~9.6K chars) and the form catalog are the two biggest sections and
    // the ones worth withholding. Passing an empty array drops each one with
    // its header (see uiToolsBriefing).
    uiToolsBriefing(
      getTools(),
      loaded.has('pages') ? visiblePages(canViewPath) : [],
      loaded.has('forms') ? FORM_CATALOG.filter((f) => canViewPath(f.route)) : [],
      languageTag(),
    ),
    `Keep replies tight. Don't restate this context.]`,
  ].filter(Boolean);

  return lines.join('\n') + '\n\n';
}

/**
 * Context envelope for the CRM Insights chat panel (`/crm/insights`, see
 * CrmInsightsChat.svelte). Frames the same personal agent as a CRM
 * conversation analyst pointed at the two conversation-intelligence tools
 * (gateway-side, landing separately): `search_crm_conversations` for
 * targeted lookups and `crm_conversation_themes` for aggregate/census
 * questions. Same envelope shape and stripping contract as
 * buildAssistantContext (model-only; sendAssistantTurn's caller strips it
 * for display) — the panel shares the personal agent's main session/thread
 * (see CrmInsightsChat.svelte for why), so this just swaps the framing.
 */
export function buildInsightsContext(): string {
  const org = activeOrg();

  const lines = [
    `[In-app assistant context — the user is on the CRM Insights page` +
      `${org.name ? ` for ${org.name}` : ''}, talking to you as a CRM conversation analyst.`,
    `Use \`search_crm_conversations\` for targeted lookups (e.g. "what did people say about ` +
      `pricing?") and \`crm_conversation_themes\` for aggregate questions (pain-point census, ` +
      `over-explaining rate, intent distribution). If a tool isn't available yet, say so plainly ` +
      `instead of guessing at data you can't see.`,
    org.multi && org.id ? `active_org_id: ${org.id} (pass to data tools as orgId).` : '',
    `Always cite how many conversations/messages back a claim, and support it with an in-app ` +
      `markdown link [label](/crm/...) — e.g. a customer name links to /crm/{id}. Links render as ` +
      `clickable navigation.`,
    `Keep replies tight. Don't restate this context.]`,
  ].filter(Boolean);

  return lines.join('\n') + '\n\n';
}
