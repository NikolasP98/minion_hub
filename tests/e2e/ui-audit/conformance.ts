/**
 * Page conformance rules (spec 014, `contracts/conformance.md`): six verdicts per
 * captured scenario, each with the numbers and element selectors that justify it.
 * `evaluateConformance` is pure over a `RuntimeUiDiagnostics` snapshot + the captured
 * events so the vitest lane can prove every rule; `collectConformance` is the
 * Playwright entry the route-audit runner calls.
 */
import type { Page } from '@playwright/test';
import {
  CONFORMANCE_ALLOWLIST,
  PAGE_SHELL_ARCHETYPE,
  type ConformanceAllowlistEntry,
} from '../../../src/lib/routes/archetype-composition';
import type { RouteArchetype } from '../../../src/lib/routes/route-design-manifest';
import { requiresSingleVisibleTitle } from './certification';
import { collectRuntimeUiDiagnostics, type RuntimeUiDiagnostics } from './runtime-diagnostics';

export type ConformanceVerdict = 'pass' | 'fail' | 'allow-listed' | 'blocked' | 'n/a';
export type ConformanceRuleId = ConformanceAllowlistEntry['rule'];
export const CONFORMANCE_RULES: readonly ConformanceRuleId[] = [
  'overflow',
  'targets',
  'dominant-action',
  'archetype',
  'health',
  'title',
];

export interface ConformanceRuleResult {
  verdict: ConformanceVerdict;
  /** Why the verdict is `blocked`, `n/a` or `allow-listed`. */
  reason?: string;
  /** overflow: document scrollWidth − clientWidth. */
  px?: number;
  /** targets: count of undersized controls outside dense regions. */
  undersized?: number;
  /** targets: dense regions by nearest component/part. */
  dense?: string[];
  /** dominant-action: primary-styled header actions counted. */
  primary?: number;
  /** title: visible route titles counted. */
  count?: number;
  /** archetype: landmarks the archetype requires but the page did not render. */
  missing?: string[];
  /** Selectors (or messages, for `health`) of the elements behind a `fail`. */
  offenders?: string[];
}

export type ConformanceEvidence = Record<ConformanceRuleId, ConformanceRuleResult>;

export interface ConformanceEvents {
  consoleErrors: readonly string[];
  pageErrors: readonly string[];
  failedSameOriginGets: readonly string[];
}

export interface ConformanceContext {
  /** Manifest pattern, e.g. `/stock/items` — the allow-list key. */
  pattern: string;
  archetype: RouteArchetype;
  pointer: 'fine' | 'coarse';
}

const TARGET_EXEMPT_ARCHETYPES = new Set<RouteArchetype>([
  'canvas-kanban',
  'terminal-remote-desktop',
]);
/** Archetypes whose recipe starts with PageShell (a missing shell is a failure, not n/a). */
const SHELL_ARCHETYPES = new Set<RouteArchetype>([
  'collection',
  'record-detail',
  'dashboard',
  'master-detail',
  'canvas-kanban',
  'terminal-remote-desktop',
]);

/** Required landmark alternatives per archetype: every group needs one of its members. */
function requiredLandmarks(archetype: RouteArchetype, formRendered: boolean): string[][] {
  switch (archetype) {
    case 'collection':
      // DataView is headless: the active renderer (table, board) or the shared state surface is the landmark.
      return [['page-header'], ['data-table', 'board-view', 'filter-toolbar', 'collection-state']];
    case 'dashboard':
      return [['editable-grid', 'kpi-grid']];
    case 'record-detail':
      return [['page-header', 'detail-header']];
    case 'form-settings':
      return [['section-shell', ...(formRendered ? ['page-shell'] : [])]];
    case 'master-detail':
      return [['page-header']];
    case 'public-auth':
      return [];
    default:
      return [['page-shell', 'section-shell']];
  }
}

export function evaluateArchetype(
  snapshot: Pick<RuntimeUiDiagnostics, 'pageShellArchetype' | 'landmarks' | 'formRendered'>,
  archetype: RouteArchetype,
): ConformanceRuleResult {
  if (archetype === 'public-auth')
    return { verdict: 'n/a', reason: 'public-auth has no composition contract' };
  const present = new Set(snapshot.landmarks);
  const missing = requiredLandmarks(archetype, snapshot.formRendered)
    .filter((group) => !group.some((landmark) => present.has(landmark)))
    .map((group) =>
      archetype === 'form-settings' && group[0] === 'section-shell'
        ? 'section-shell | page-shell + form'
        : group.join(' | '),
    );
  const expectedShell = PAGE_SHELL_ARCHETYPE[archetype];
  if (snapshot.pageShellArchetype === null) {
    if (SHELL_ARCHETYPES.has(archetype))
      missing.unshift(`page-shell[data-archetype="${expectedShell}"]`);
  } else if (snapshot.pageShellArchetype !== expectedShell) {
    missing.unshift(
      `page-shell[data-archetype="${expectedShell}"] (rendered "${snapshot.pageShellArchetype}")`,
    );
  }
  return missing.length === 0 ? { verdict: 'pass', missing } : { verdict: 'fail', missing };
}

export function evaluateConformance(
  snapshot: RuntimeUiDiagnostics,
  context: ConformanceContext,
  events: ConformanceEvents,
  allowlist: readonly ConformanceAllowlistEntry[] = CONFORMANCE_ALLOWLIST,
): ConformanceEvidence {
  const targetsExempt = TARGET_EXEMPT_ARCHETYPES.has(context.archetype);
  const healthOffenders = [
    ...events.consoleErrors.map((value) => `console: ${value}`),
    ...events.pageErrors.map((value) => `page: ${value}`),
    ...events.failedSameOriginGets.map((value) => `GET: ${value}`),
  ];
  const measured: ConformanceEvidence = {
    overflow: snapshot.documentOverflowAllowed
      ? {
          verdict: 'allow-listed',
          reason: 'data-allow-document-overflow="true"',
          px: snapshot.documentOverflowPx,
        }
      : {
          verdict: snapshot.documentOverflowPx === 0 ? 'pass' : 'fail',
          px: snapshot.documentOverflowPx,
        },
    targets:
      context.pointer === 'fine'
        ? { verdict: 'n/a', reason: 'fine pointer', dense: snapshot.denseRegions }
        : targetsExempt
          ? {
              verdict: 'n/a',
              reason: `${context.archetype} is exempt`,
              dense: snapshot.denseRegions,
            }
          : {
              verdict: snapshot.undersizedInteractiveElements.length === 0 ? 'pass' : 'fail',
              undersized: snapshot.undersizedInteractiveElements.length,
              dense: snapshot.denseRegions,
              offenders: snapshot.undersizedInteractiveElements,
            },
    'dominant-action': !snapshot.landmarks.includes('page-header')
      ? { verdict: 'n/a', reason: 'no page-header rendered' }
      : targetsExempt
        ? { verdict: 'n/a', reason: `${context.archetype} is exempt` }
        : {
            verdict: snapshot.primaryHeaderActions.length <= 1 ? 'pass' : 'fail',
            primary: snapshot.primaryHeaderActions.length,
            offenders: snapshot.primaryHeaderActions,
          },
    archetype: evaluateArchetype(snapshot, context.archetype),
    health:
      healthOffenders.length === 0
        ? { verdict: 'pass' }
        : { verdict: 'fail', offenders: healthOffenders },
    title: !requiresSingleVisibleTitle(context.archetype)
      ? { verdict: 'n/a', reason: `${context.archetype} has no title contract` }
      : {
          verdict: snapshot.visibleRouteTitles.length === 1 ? 'pass' : 'fail',
          count: snapshot.visibleRouteTitles.length,
          offenders: snapshot.visibleRouteTitles,
        },
  };
  for (const rule of CONFORMANCE_RULES) {
    const entry = allowlist.find(
      (candidate) => candidate.page === context.pattern && candidate.rule === rule,
    );
    if (entry && measured[rule].verdict === 'fail') {
      measured[rule] = {
        ...measured[rule],
        verdict: 'allow-listed',
        reason: entry.reason ?? entry.drift ?? 'allow-listed without a reason',
      };
    }
  }
  return measured;
}

/**
 * Health is judged on everything the page did while it was open, so the spec re-evaluates it
 * after the scenario's event capture stops (the DOM snapshot rules keep their earlier verdicts).
 */
export function finalizeHealth(
  evidence: ConformanceEvidence,
  events: ConformanceEvents,
  pattern: string,
  allowlist: readonly ConformanceAllowlistEntry[] = CONFORMANCE_ALLOWLIST,
): ConformanceEvidence {
  if (evidence.health.verdict === 'blocked') return evidence;
  const offenders = [
    ...events.consoleErrors.map((value) => `console: ${value}`),
    ...events.pageErrors.map((value) => `page: ${value}`),
    ...events.failedSameOriginGets.map((value) => `GET: ${value}`),
  ];
  let health: ConformanceRuleResult =
    offenders.length === 0 ? { verdict: 'pass' } : { verdict: 'fail', offenders };
  const entry = allowlist.find((c) => c.page === pattern && c.rule === 'health');
  if (entry && health.verdict === 'fail') {
    health = {
      ...health,
      verdict: 'allow-listed',
      reason: entry.reason ?? entry.drift ?? 'allow-listed without a reason',
    };
  }
  return { ...evidence, health };
}

export function blockedConformance(reason: string): ConformanceEvidence {
  return Object.fromEntries(
    CONFORMANCE_RULES.map((rule) => [rule, { verdict: 'blocked', reason }]),
  ) as ConformanceEvidence;
}

export async function collectConformance(
  page: Page,
  route: { pattern: string; archetype: RouteArchetype },
  viewport: { width: number; height: number },
  pointer: 'fine' | 'coarse',
  events: ConformanceEvents,
): Promise<ConformanceEvidence> {
  const actual = page.viewportSize();
  if (!actual || actual.width !== viewport.width || actual.height !== viewport.height) {
    return blockedConformance(
      `viewport ${actual?.width}x${actual?.height} does not match requested ${viewport.width}x${viewport.height}`,
    );
  }
  try {
    const snapshot = await collectRuntimeUiDiagnostics(page, {
      minimumInteractiveTargetPx: pointer === 'coarse' ? 44 : 24,
    });
    return evaluateConformance(
      snapshot,
      { pattern: route.pattern, archetype: route.archetype, pointer },
      events,
    );
  } catch (error) {
    return blockedConformance(
      `not measured: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
