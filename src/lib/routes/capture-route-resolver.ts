import { getCaptureFixture, type FixtureContext, type FixtureResolution } from './capture-fixtures';
import type {
  CapturePersonaId,
  CaptureState,
  CaptureViewport,
  ScreenDesignMeta,
} from './route-design-manifest';

export interface ResolvedCaptureRoute {
  routeId: string;
  pattern: string;
  url: string;
  persona: CapturePersonaId;
  viewport: CaptureViewport;
  state: CaptureState;
  fixtureId: ScreenDesignMeta['capture']['fixtureId'];
  /** Stable key the runner uses to install state/persona-specific mocks. */
  scenarioKey: string;
}

export interface CaptureExecutionContext extends FixtureContext {
  /**
   * Required execution hook. A runner must prepare the named state/persona;
   * otherwise a matrix would only relabel the same default UI many times.
   */
  prepareState(entry: ResolvedCaptureRoute): Promise<void>;
}

function interpolatePattern(pattern: string, params: Readonly<Record<string, string>>): string {
  return pattern.replace(/\[(\.\.\.)?([^\]]+)\]/g, (_, rest: string | undefined, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`Missing capture parameter "${key}" for ${pattern}`);
    return rest
      ? value
          .split('/')
          .map((part) => encodeURIComponent(part))
          .join('/')
      : encodeURIComponent(value);
  });
}

function mergeResolution(
  route: ScreenDesignMeta,
  fixture: FixtureResolution,
): Required<FixtureResolution> {
  return {
    params: { ...(fixture.params ?? {}), ...(route.capture.params ?? {}) },
    query: { ...(fixture.query ?? {}), ...(route.capture.query ?? {}) },
  };
}

export async function resolveCaptureUrl(
  route: ScreenDesignMeta,
  context: FixtureContext,
): Promise<string> {
  const fixture =
    route.capture.fixtureId === 'base-tenant'
      ? {}
      : await getCaptureFixture(route.capture.fixtureId).provision(context);
  const resolved = mergeResolution(route, fixture);
  const pathname = interpolatePattern(route.pattern, resolved.params);
  const query = new URLSearchParams(resolved.query);
  return query.size > 0 ? `${pathname}?${query.toString()}` : pathname;
}

export async function resolveCaptureMatrix(
  routes: readonly ScreenDesignMeta[],
  context: FixtureContext,
): Promise<ResolvedCaptureRoute[]> {
  const output: ResolvedCaptureRoute[] = [];
  for (const route of routes) {
    const fixture =
      route.capture.fixtureId === 'base-tenant' ? {} : getCaptureFixture(route.capture.fixtureId);
    const resolved = mergeResolution(route, fixture);
    const pathname = interpolatePattern(route.pattern, resolved.params);
    const query = new URLSearchParams(resolved.query);
    const url = query.size > 0 ? `${pathname}?${query.toString()}` : pathname;
    for (const persona of route.capture.personas) {
      for (const viewport of route.capture.viewports) {
        for (const state of route.capture.states) {
          output.push({
            routeId: route.id,
            pattern: route.pattern,
            url,
            persona,
            viewport,
            state,
            fixtureId: route.capture.fixtureId,
            scenarioKey: [context.namespace, route.id, persona, viewport, state].join(':'),
          });
        }
      }
    }
  }
  return output;
}

/**
 * Prepare one capture-plan entry immediately before navigation/screenshot.
 * `resolveCaptureMatrix` only creates a plan; execution must come through this
 * function (or an equivalent runner that provisions the fixture and state).
 */
export async function prepareCapturePlanEntry(
  route: ScreenDesignMeta,
  entry: ResolvedCaptureRoute,
  context: CaptureExecutionContext,
): Promise<string> {
  if (route.id !== entry.routeId) {
    throw new Error(`Capture entry ${entry.routeId} does not belong to route ${route.id}`);
  }
  const url = await resolveCaptureUrl(route, context);
  await context.prepareState({ ...entry, url });
  return url;
}

export async function resetCapturePlanEntry(
  route: ScreenDesignMeta,
  context: FixtureContext,
): Promise<void> {
  if (route.capture.fixtureId !== 'base-tenant') {
    await getCaptureFixture(route.capture.fixtureId).reset(context);
  }
}
