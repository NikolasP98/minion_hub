/**
 * Client side of the JEV turn router (see
 * `$server/services/assistant-router.service` for the classifier call).
 * Classifies the user's turn so `buildAssistantContext()` can skip the context
 * manifests it doesn't need instead of prepending the full ~4.3K-token envelope
 * to every turn.
 *
 * Two typed stages in one request, same shape as the owner's pre-tool-use hook:
 * ONE `choice` over mutually exclusive modes (what kind of turn is this), then
 * one independent `noul` per manifest (does this turn need X). The gate reads
 * the NOULS, not the mode softmax: a turn like "add 4 boxes of X at 1200" needs
 * pages AND forms, and probabilities that sum to 1 cannot express "both".
 * The mode is what we label and log.
 *
 * Fails open end-to-end: `off` mode, a network error, a timeout or a non-200
 * response all resolve to `null`, and a `null` decision always means "send
 * today's full envelope" (see `gateManifests`).
 */
import { env } from '$env/dynamic/public';

export type RouteMode =
  'navigate' | 'record_action' | 'data_question' | 'knowledge_question' | 'chat';

export const ROUTE_MODES: readonly RouteMode[] = [
  'navigate',
  'record_action',
  'data_question',
  'knowledge_question',
  'chat',
];

/** The envelope sections the router can withhold. `core` is never gated. */
export type ManifestId = 'pages' | 'forms' | 'data' | 'brain' | 'changelog' | 'sandbox';

export const MANIFEST_IDS: readonly ManifestId[] = [
  'pages',
  'forms',
  'data',
  'brain',
  'changelog',
  'sandbox',
];

export interface RouteDecision {
  mode: RouteMode;
  probabilities: Partial<Record<RouteMode, number>>;
  manifests: Partial<Record<ManifestId, number>>;
  ms: number;
  cost: number;
}

/**
 * The one table both sides read: id → the mode it belongs to, the yes/no
 * question the classifier is asked, its threshold, and (where the text is
 * static) the prose the client injects when it loads.
 *
 * Thresholds are hardcoded, one measured comment each; calibration comes later
 * from the logged `assistant_route` events, not from a settings UI.
 *
 * TODO(handoff): every threshold below was set from 12 live classifier probes on
 * 2026-10-12, not from a distribution. Re-derive them from the `assistant_route`
 * PostHog events (they carry p_pages/p_forms/p_data/p_brain/p_changelog and the
 * chosen mode) after ~200 real turns; `brain` is the weakest signal and the most
 * likely to move. See meta proposals/2026-10-12-hub-assistant-jev-context-router.md
 * open ends 1 and 2.
 */
export interface ContextManifest {
  id: ManifestId;
  /** The mode this manifest serves — logging/triage only; the gate is the noul. */
  mode: RouteMode;
  question: string;
  threshold: number;
  /** Static inject text, or null when the section is rendered from live state. */
  inject: string | null;
}

export const CONTEXT_MANIFESTS: readonly ContextManifest[] = [
  {
    id: 'pages',
    mode: 'navigate',
    question: 'Does answering this request need the list of dashboard pages the user may open?',
    // 0.35, not the 0.5 the spec proposed: measured live 2026-10-12, a
    // "¿dónde configuro los horarios?" turn scores 0.41 — and UI_TOOL_RULES (1)
    // says a "where/how do I…" question must navigate, so 0.5 silently broke
    // the exact case that rule exists for. Non-navigation turns measured
    // 0.06-0.26, navigation turns 0.41-0.70, so 0.35 separates them with room
    // either side. Recalibrate from the logged `assistant_route` events.
    threshold: 0.35,
    inject: null, // rendered from visiblePages(canViewPath) — per-user permissions
  },
  {
    id: 'forms',
    mode: 'record_action',
    question:
      'Does this request ask to create, fill in or edit a record through a form in the app?',
    // 0.6, higher than pages: filling a form is the costlier wrong guess (the
    // agent starts a record the user never asked for). Measured 0.51 on a bare
    // "open the new customer form", so this deliberately needs an explicit
    // create/fill intent.
    threshold: 0.6,
    inject: null, // rendered from FORM_CATALOG filtered by canViewPath
  },
  {
    id: 'data',
    mode: 'data_question',
    question: "Does this request need a lookup of this organization's live business data?",
    // 0.5: measured 0.92 on "how much did we invoice last month" vs <=0.43 on
    // navigation and changelog turns — a wide margin either side of 0.5.
    threshold: 0.5,
    inject: null, // static prose, but lives with the other data-tool wording
  },
  {
    id: 'brain',
    mode: 'knowledge_question',
    question:
      'Does this request need semantic search over the organization’s own knowledge, history or past conversations?',
    // 0.5: this noul sat at 0.48-0.50 on turns that do NOT need it, so it is
    // the weakest of the five. Left at the spec's 0.5 and flagged for
    // calibration from the decision log rather than tuned on four samples.
    threshold: 0.5,
    inject: null, // static prose, kept next to the brains_list/brain_search wording
  },
  {
    id: 'changelog',
    mode: 'knowledge_question',
    question:
      "Does this request ask about the Minion dashboard's own updates, releases, changelog or version history?",
    // 0.45, down from 0.6: measured 0.94 on "summarize the latest changelog" on
    // 2026-10-12 vs <=0.02 on every other probe, but the same prompt measured
    // 0.61 on 2026-10-15 — one bad roll from regressing. The next-highest false
    // score across 46 probes that day was 0.07, so 0.45 keeps a wide margin.
    threshold: 0.45,
    // TODO(handoff): prose only — the latest release notes are NOT inlined here,
    // because fetching them would add a getCoreDb() query to EVERY assistant turn
    // and production Postgres is CPU-throttled. Better fix: a `hub_releases` tool
    // on the gateway agent so it reads them only when it needs them. See meta
    // proposals/2026-10-12-hub-assistant-jev-context-router.md open end 3.
    inject:
      'If the user asks about this dashboard’s own updates, releases, changelog or ' +
      '"what’s new": answer from the hub’s own release notes and link the user to ' +
      '[the changelog](/changelog). These are THIS app’s releases. Never web-search ' +
      'other projects (OpenClaw, Claude Code, upstream forks) to answer it, and never ' +
      'present another project’s release notes as ours.',
  },
  {
    id: 'sandbox',
    // Same mode as `forms`: authoring a visual IS a record action. The mode
    // rule below therefore loads this manifest on EVERY record_action turn,
    // which is deliberate and harmless — the envelope section is additionally
    // gated on the route being /sandbox (assistant-context.ts), and off the
    // sandbox the five sandbox.* tools are not even registered.
    mode: 'record_action',
    question:
      'Is the user asking to create, change or remove a chart, table or visual element on the ' +
      'page they are on?',
    // 0.5, the spec's initial value, not measured: this manifest only ever
    // reaches the envelope on /sandbox, so a false positive costs nothing
    // elsewhere. Recalibrate from `assistant_route` p_sandbox once the POC has
    // real turns.
    threshold: 0.5,
    // Two tiers (spec 013): tier 2 curates the board (the canvas map in the
    // envelope is its input), tier 1 builds one element. Both ride on the
    // record_action turn; a plain chat turn on /sandbox pays neither (SC-004).
    inject:
      'Tier 2, curate first: the canvas map in your context is the board. If an element already ' +
      'covers the same datasets and intent, update it by id (sandbox.upsert_element with `id`); ' +
      'never add a duplicate. Place and size with sandbox.arrange (4 columns: KPI w=1, chart ' +
      'w=2, time series w=4; keep related visuals adjacent). Tier 1, build one element — ' +
      'Sandbox element authoring. One visual per element, written as vanilla HTML/CSS/JS — no ' +
      'imports, no framework, no external URLs and no fetch (the frame has no network). Inside ' +
      'the frame you get `minion`: `minion.ready(fn)` runs fn once the runtime is up; `await ' +
      'minion.query(spec)` returns `{columns, rows}` for a dataset spec (same spec shape as ' +
      'sandbox.preview, but up to 1000 rows); `minion.theme` maps the semantic design tokens to ' +
      'CSS values; `await minion.echarts` resolves ECharts (default); `await minion.d3` a slim ' +
      'd3 (bespoke marks, trees, force graphs); `await minion.echartsGl` echarts with 3D series ' +
      '(bar3D, scatter3D, surface) registered; `minion.size` is the element box in ' +
      'px and re-fires on resize. Order of work: sandbox.datasets, then sandbox.preview the spec ' +
      'you intend to use, then sandbox.upsert_element. Put the calculations (margin, ratios, ' +
      'totals, grouping) in the element JS, not in the query. For a chart: `const echarts = ' +
      'await minion.echarts`, then colour the series from `minion.theme`. Size with `w`/`h` in ' +
      'grid units 1-4. Catch errors and render the message inside the element so the user reads ' +
      'it instead of a blank box. To change an existing visual, call sandbox.upsert_element with ' +
      'its `id` (sandbox.list_elements gives you the ids). Reads (sandbox.datasets, sandbox.preview, ' +
      'sandbox.list_elements) come back to you in a follow-up turn; a successful write ends the turn, ' +
      'so put every sandbox.upsert_element and sandbox.arrange for the request in ONE reply.',
  },
];

/** Probability thresholds above which a manifest earns its tokens. */
export const MANIFEST_THRESHOLDS = Object.freeze(
  Object.fromEntries(CONTEXT_MANIFESTS.map((m) => [m.id, m.threshold])),
) as Readonly<Record<ManifestId, number>>;

/** What the classifier is asked, per manifest. Server-side question text. */
export const MANIFEST_QUESTIONS = Object.freeze(
  Object.fromEntries(CONTEXT_MANIFESTS.map((m) => [m.id, m.question])),
) as Readonly<Record<ManifestId, string>>;

const TIMEOUT_MS = 1500;

export type RouterConfigMode = 'off' | 'shadow' | 'enforce';

/** `PUBLIC_ASSISTANT_ROUTER`: off = never call; shadow = call + log, gate nothing;
 * enforce (default) = call and gate. Owner's stated goal is the token cut. */
export function routerMode(): RouterConfigMode {
  const value = env.PUBLIC_ASSISTANT_ROUTER;
  return value === 'off' || value === 'shadow' ? value : 'enforce';
}

/**
 * The gate, pure: a decision → the set of manifests that earned their tokens.
 * `null` (no decision, or shadow mode) → every manifest, i.e. today's envelope.
 */
export function gateManifests(
  decision: RouteDecision | null,
  mode: RouterConfigMode = 'enforce',
  /** Canonical route the turn was sent from. */
  page?: string,
): ReadonlySet<ManifestId> {
  if (!decision || mode !== 'enforce') return new Set(MANIFEST_IDS);
  const loaded = new Set<ManifestId>();
  for (const manifest of CONTEXT_MANIFESTS) {
    const p = decision.manifests[manifest.id];
    if (typeof p === 'number' && p >= manifest.threshold) loaded.add(manifest.id);
  }
  // The winning mode always earns its own manifest, even when its noul scored
  // below threshold — a turn correctly classified should never get core-only.
  for (const manifest of CONTEXT_MANIFESTS) {
    if (manifest.mode === decision.mode) loaded.add(manifest.id);
  }
  // On the sandbox every non-chat turn is about the board: the classifier filed
  // "create visuals on this page" under navigate in prod, and without this
  // manifest the model had the tool list but no authoring rules (spec 022).
  if (page === '/sandbox' && decision.mode !== 'chat') loaded.add('sandbox');
  return loaded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateRouteDecision(value: unknown): RouteDecision | null {
  if (
    !isRecord(value) ||
    !ROUTE_MODES.includes(value.mode as RouteMode) ||
    !isRecord(value.probabilities) ||
    !isRecord(value.manifests) ||
    !['ms', 'cost'].every(
      (key) =>
        typeof value[key] === 'number' &&
        Number.isFinite(value[key]) &&
        (value[key] as number) >= 0,
    )
  )
    return null;
  for (const [record, allowed] of [
    [value.probabilities, ROUTE_MODES],
    [value.manifests, MANIFEST_IDS],
  ] as const)
    for (const [key, probability] of Object.entries(record))
      if (
        !(allowed as readonly string[]).includes(key) ||
        typeof probability !== 'number' ||
        !Number.isFinite(probability) ||
        probability < 0 ||
        probability > 1
      )
        return null;
  return value as unknown as RouteDecision;
}

/** POSTs the user's turn to the hub's own classifier route. Never throws and
 * never blocks a send past the timeout — any failure resolves to `null`. */
export interface RouteAttempt {
  attemptId: string;
  submissionId: string | null;
  requestedModel: string;
  resolvedModel: string | null;
  schemaRevision: string;
  questionRevision: string;
  gateRevision: string;
  elapsedMs: number;
  serverDeadlineMs: number;
  disposition: 'ok' | 'timeout' | 'error' | 'invalid';
  inputTokens?: number;
  outputTokens?: number;
  cost: { status: 'known'; usd: number } | { status: 'unknown'; usd: null };
}
export interface RouteEvidence {
  decision: RouteDecision | null;
  attempt: RouteAttempt | null;
}
export const canonicalUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const modelId = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9~_.:/+-]{1,160}$/.test(v);
export function validateRouteAttempt(value: unknown): RouteAttempt | null {
  if (
    !isRecord(value) ||
    !canonicalUuid(value.attemptId) ||
    !(value.submissionId === null || canonicalUuid(value.submissionId)) ||
    !modelId(value.requestedModel) ||
    !(value.resolvedModel === null || modelId(value.resolvedModel)) ||
    !['schemaRevision', 'questionRevision', 'gateRevision'].every(
      (k) => typeof value[k] === 'string' && /^[a-f0-9]{64}$/.test(value[k] as string),
    ) ||
    !['ok', 'timeout', 'error', 'invalid'].includes(String(value.disposition)) ||
    !['elapsedMs', 'serverDeadlineMs'].every(
      (k) => typeof value[k] === 'number' && Number.isFinite(value[k]) && (value[k] as number) >= 0,
    ) ||
    !isRecord(value.cost)
  )
    return null;
  if (
    !(value.cost.status === 'unknown' && value.cost.usd === null) &&
    !(
      value.cost.status === 'known' &&
      typeof value.cost.usd === 'number' &&
      Number.isFinite(value.cost.usd) &&
      value.cost.usd >= 0
    )
  )
    return null;
  if (
    ['inputTokens', 'outputTokens'].some(
      (k) =>
        value[k] !== undefined &&
        !(
          typeof value[k] === 'number' &&
          Number.isSafeInteger(value[k]) &&
          (value[k] as number) >= 0
        ),
    )
  )
    return null;
  return value as unknown as RouteAttempt;
}
export async function requestRouteDecisionWithEvidence(
  text: string,
  locale?: string,
  page?: string,
  opts: { signal?: AbortSignal; submissionId?: string } = {},
): Promise<RouteEvidence> {
  const empty = { decision: null, attempt: null };
  if (routerMode() === 'off') return empty;
  try {
    const res = await fetch('/api/assistant/route', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(canonicalUuid(opts.submissionId) ? { 'x-minion-run-id': opts.submissionId } : {}),
      },
      body: JSON.stringify({ text, locale, page }),
      signal: opts.signal
        ? AbortSignal.any([opts.signal, AbortSignal.timeout(TIMEOUT_MS)])
        : AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return empty;
    const body: unknown = await res.json();
    if (!isRecord(body)) return empty;
    return {
      decision: validateRouteDecision(body.decision),
      attempt: validateRouteAttempt(body.attempt),
    };
  } catch {
    return empty;
  }
}
/** Nullable compatibility wrapper for existing callers. */
export async function requestRouteDecision(
  text: string,
  locale?: string,
  page?: string,
  opts: { signal?: AbortSignal; submissionId?: string } = {},
): Promise<RouteDecision | null> {
  return (await requestRouteDecisionWithEvidence(text, locale, page, opts)).decision;
}
