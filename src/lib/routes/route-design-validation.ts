import { CAPTURE_FIXTURES, CAPTURE_FIXTURE_IDS, type CaptureFixtureId } from './capture-fixtures';
import { COMPONENT_DESIGN_REGISTRY, type ComponentDesignMeta } from './component-design-registry';
import { isKnownRouteAccessPolicy } from './route-access-policies';
import {
  FIGMA_PAGE_BY_FAMILY,
  REDIRECT_DESIGN_MANIFEST,
  ROUTE_DESIGN_MANIFEST,
  SCREEN_DESIGN_MANIFEST,
  type RedirectDesignMeta,
  type RouteDesignMeta,
  type ScreenDesignMeta,
} from './route-design-manifest';

export const ROUTE_CONTRACT_EXPECTATIONS = Object.freeze({
  endpoints: 149,
  screens: 139,
  redirects: 10,
  fixtures: 27,
  viewports: ['compact', 'medium', 'wide'] as const,
});

export const IMMERSIVE_SCREEN_PATTERNS = Object.freeze([
  '/agents/autonomous',
  '/agents/autonomous/[id]',
  '/agents/workshop',
  '/agents/workshop/[id]',
  '/agents/workshop/compare',
  '/agents/workshop/groupchat',
  '/agents/workshop/leaderboard',
  '/cloud',
  '/cloud/gui',
  '/cloud/settings',
  '/cloud/terminal',
  '/home',
  '/home/settings',
]);

export interface ContractIssue {
  code: string;
  message: string;
  subject?: string;
}

export interface RedirectSourceContract {
  pattern: string;
  sourceFiles: readonly string[];
  source: string;
}

export interface NavReference {
  sourceFile: string;
  href: string;
}

export interface ComponentContractSnapshot {
  /** Export path (or a sourcePath override) -> source/declaration text. */
  sourceText: Readonly<Record<string, string>>;
  /** Package name -> public index declaration. */
  packageIndexes: Readonly<Record<string, string>>;
}

function issue(code: string, message: string, subject?: string): ContractIssue {
  return { code, message, subject };
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

export function routePatternParams(pattern: string): string[] {
  return [...pattern.matchAll(/\[(?:\.\.\.)?([^\]]+)\]/g)].map((match) => match[1]);
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    [...left].sort().every((value, index) => value === [...right].sort()[index])
  );
}

function fixtureParams(route: ScreenDesignMeta): Readonly<Record<string, string>> {
  const fixture =
    route.capture.fixtureId === 'base-tenant'
      ? undefined
      : CAPTURE_FIXTURES[route.capture.fixtureId];
  return { ...(fixture?.params ?? {}), ...(route.capture.params ?? {}) };
}

function validateScreen(route: ScreenDesignMeta): ContractIssue[] {
  const output: ContractIssue[] = [];
  if (!sameValues(route.capture.viewports, ROUTE_CONTRACT_EXPECTATIONS.viewports)) {
    output.push(
      issue(
        'screen.viewports',
        'Every screen must retain compact, medium and wide capture viewports.',
        route.pattern,
      ),
    );
  }
  if (route.capture.states.length === 0 || duplicates(route.capture.states).length > 0) {
    output.push(
      issue('screen.states', 'Capture states must be non-empty and unique.', route.pattern),
    );
  }
  if (route.capture.personas.length === 0 || duplicates(route.capture.personas).length > 0) {
    output.push(
      issue('screen.personas', 'Capture personas must be non-empty and unique.', route.pattern),
    );
  }
  if (route.figma.page !== FIGMA_PAGE_BY_FAMILY[route.family]) {
    output.push(
      issue('screen.figma-page', 'Figma page does not match the route family.', route.pattern),
    );
  }
  if (!route.figma.framePrefix) {
    output.push(issue('screen.frame-prefix', 'Figma frame prefix is empty.', route.pattern));
  }
  const availableParams = fixtureParams(route);
  for (const param of routePatternParams(route.pattern)) {
    if (!availableParams[param]) {
      output.push(
        issue(
          'screen.fixture-param',
          `Capture fixture does not resolve dynamic parameter "${param}".`,
          route.pattern,
        ),
      );
    }
  }
  return output;
}

function validateRedirect(route: RedirectDesignMeta): ContractIssue[] {
  const output: ContractIssue[] = [];
  if (route.nav !== 'hidden' || route.breadcrumb.kind !== 'none') {
    output.push(
      issue(
        'redirect.presentation',
        'Redirects must stay hidden and breadcrumb-free.',
        route.pattern,
      ),
    );
  }
  const catchAll = /\[\.\.\.[^\]]+\]/.test(route.pattern);
  if (Boolean(route.preservePath) !== catchAll) {
    output.push(
      issue(
        'redirect.path-preservation',
        'Catch-all redirects must explicitly preserve their remaining path.',
        route.pattern,
      ),
    );
  }
  const targetPath = route.target.split(/[?#]/, 1)[0];
  if (!SCREEN_DESIGN_MANIFEST.some((candidate) => candidate.pattern === targetPath)) {
    output.push(
      issue(
        'redirect.target',
        `Redirect target ${targetPath} is not a screen route.`,
        route.pattern,
      ),
    );
  }
  return output;
}

export function validateRouteDesignManifest(
  routes: readonly RouteDesignMeta[] = ROUTE_DESIGN_MANIFEST,
): ContractIssue[] {
  const output: ContractIssue[] = [];
  const screens = routes.filter((route): route is ScreenDesignMeta => route.kind === 'screen');
  const redirects = routes.filter(
    (route): route is RedirectDesignMeta => route.kind === 'redirect',
  );

  if (routes.length !== ROUTE_CONTRACT_EXPECTATIONS.endpoints) {
    output.push(
      issue(
        'manifest.endpoint-count',
        `Expected ${ROUTE_CONTRACT_EXPECTATIONS.endpoints} endpoints; found ${routes.length}.`,
      ),
    );
  }
  if (screens.length !== ROUTE_CONTRACT_EXPECTATIONS.screens) {
    output.push(
      issue(
        'manifest.screen-count',
        `Expected ${ROUTE_CONTRACT_EXPECTATIONS.screens} screens; found ${screens.length}.`,
      ),
    );
  }
  if (redirects.length !== ROUTE_CONTRACT_EXPECTATIONS.redirects) {
    output.push(
      issue(
        'manifest.redirect-count',
        `Expected ${ROUTE_CONTRACT_EXPECTATIONS.redirects} redirects; found ${redirects.length}.`,
      ),
    );
  }
  for (const repeated of duplicates(routes.map((route) => route.pattern))) {
    output.push(issue('manifest.duplicate-pattern', 'Route pattern is duplicated.', repeated));
  }
  for (const repeated of duplicates(routes.map((route) => route.id))) {
    output.push(issue('manifest.duplicate-id', 'Route metadata ID is duplicated.', repeated));
  }
  for (const route of routes) {
    if (!route.pattern.startsWith('/')) {
      output.push(issue('manifest.pattern', 'Route pattern must start with /.', route.pattern));
    }
    if (!route.title().trim()) {
      output.push(issue('manifest.title', 'Route title is empty.', route.pattern));
    }
    if (!isKnownRouteAccessPolicy(route.accessPolicyId)) {
      output.push(
        issue(
          'manifest.access-policy',
          'Route references an unknown access policy.',
          route.pattern,
        ),
      );
    }
    output.push(...(route.kind === 'screen' ? validateScreen(route) : validateRedirect(route)));
  }

  if (CAPTURE_FIXTURE_IDS.length !== ROUTE_CONTRACT_EXPECTATIONS.fixtures) {
    output.push(
      issue(
        'fixture.count',
        `Expected ${ROUTE_CONTRACT_EXPECTATIONS.fixtures} fixtures; found ${CAPTURE_FIXTURE_IDS.length}.`,
      ),
    );
  }
  for (const repeated of duplicates(CAPTURE_FIXTURE_IDS)) {
    output.push(issue('fixture.duplicate-id', 'Fixture ID is duplicated.', repeated));
  }
  const usedFixtures = new Set<CaptureFixtureId>();
  for (const route of screens) {
    if (route.capture.fixtureId !== 'base-tenant') usedFixtures.add(route.capture.fixtureId);
  }
  for (const fixtureId of CAPTURE_FIXTURE_IDS) {
    if (!usedFixtures.has(fixtureId)) {
      output.push(issue('fixture.unused', 'Fixture is not referenced by a screen.', fixtureId));
    }
  }

  const immersive = screens
    .filter((route) => route.family === 'immersive-workspaces')
    .map((route) => route.pattern);
  if (!sameValues(immersive, IMMERSIVE_SCREEN_PATTERNS)) {
    output.push(
      issue(
        'manifest.immersive-family',
        'Immersive family must cover Home, Autonomous, Workshop, and Cloud workspace routes.',
      ),
    );
  }

  return output;
}

export function validateFilesystemRouteCoverage(
  filesystemPatterns: readonly string[],
  routes: readonly RouteDesignMeta[] = ROUTE_DESIGN_MANIFEST,
): ContractIssue[] {
  const output: ContractIssue[] = [];
  const filesystem = new Set(filesystemPatterns);
  const manifest = new Set(routes.map((route) => route.pattern));
  for (const pattern of [...filesystem].sort()) {
    if (!manifest.has(pattern)) {
      output.push(
        issue('filesystem.unregistered', 'Filesystem page is missing metadata.', pattern),
      );
    }
  }
  for (const pattern of [...manifest].sort()) {
    if (!filesystem.has(pattern)) {
      output.push(issue('filesystem.missing', 'Metadata has no filesystem page.', pattern));
    }
  }
  return output;
}

export function validateRedirectSourceContracts(
  sources: readonly RedirectSourceContract[],
  redirects: readonly RedirectDesignMeta[] = REDIRECT_DESIGN_MANIFEST,
): ContractIssue[] {
  const output: ContractIssue[] = [];
  const byPattern = new Map(sources.map((source) => [source.pattern, source]));
  for (const route of redirects) {
    const source = byPattern.get(route.pattern);
    if (!source) {
      output.push(
        issue('redirect.source-missing', 'Redirect implementation is missing.', route.pattern),
      );
      continue;
    }
    if (!new RegExp(`redirect\\(\\s*${route.status}\\s*,`).test(source.source)) {
      output.push(
        issue(
          'redirect.status-drift',
          `Implementation does not use ${route.status}.`,
          route.pattern,
        ),
      );
    }
    if (!source.source.includes(route.target)) {
      output.push(
        issue(
          'redirect.target-drift',
          `Implementation does not contain ${route.target}.`,
          route.pattern,
        ),
      );
    }
    const preservesQuery = source.source.includes('url.search');
    if (preservesQuery !== route.preserveQuery) {
      output.push(
        issue(
          'redirect.query-drift',
          'Query-preservation metadata disagrees with source.',
          route.pattern,
        ),
      );
    }
    const catchAllParam = route.pattern.match(/\[\.\.\.([^\]]+)\]/)?.[1];
    const preservesPath = Boolean(
      catchAllParam && source.source.includes(`params.${catchAllParam}`),
    );
    if (preservesPath !== Boolean(route.preservePath)) {
      output.push(
        issue(
          'redirect.path-drift',
          'Path-preservation metadata disagrees with source.',
          route.pattern,
        ),
      );
    }
    for (const alternate of route.alternates ?? []) {
      if (!source.source.includes(alternate)) {
        output.push(
          issue(
            'redirect.alternate-drift',
            `Implementation does not contain alternate ${alternate}.`,
            route.pattern,
          ),
        );
      }
    }
  }
  return output;
}

function namedTypeBody(source: string, typeName: string): string | undefined {
  const escaped = typeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:export\\s+)?type\\s+${escaped}\\s*=`).exec(source);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') braces += 1;
    else if (char === '}') braces -= 1;
    else if (char === '[') brackets += 1;
    else if (char === ']') brackets -= 1;
    else if (char === '(') parentheses += 1;
    else if (char === ')') parentheses -= 1;
    else if (char === ';' && braces === 0 && brackets === 0 && parentheses === 0) {
      return source.slice(start, index);
    }
  }
  return undefined;
}

function literalValues(body: string): string[] | undefined {
  if (!body) return undefined;
  const values = [...body.matchAll(/['"]([^'"]+)['"]|\b(\d+)\b/g)].map(
    (match) => match[1] ?? match[2],
  );
  return values.length > 0 ? values : undefined;
}

function literalUnion(source: string, typeName: string): string[] | undefined {
  const body = namedTypeBody(source, typeName);
  return body ? literalValues(body) : undefined;
}

function propertyValues(source: string, propertyName: string): string[] | undefined {
  const escaped = propertyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const expression = source.match(new RegExp(`\\b${escaped}\\??\\s*:\\s*([^;\\n}]+)`))?.[1];
  if (!expression) return undefined;
  if (expression.trim() === 'boolean') return ['false', 'true'];
  const inline = literalValues(expression);
  if (inline) return inline;
  const referencedType = expression.trim().match(/^([A-Za-z_$][\w$]*)$/)?.[1];
  return referencedType ? literalUnion(source, referencedType) : undefined;
}

function packageName(exportPath: string): string | undefined {
  if (!exportPath.startsWith('@')) return undefined;
  return exportPath.split('#', 1)[0];
}

export function validateComponentDesignRegistry(
  snapshot: ComponentContractSnapshot,
  registry: readonly ComponentDesignMeta[] = COMPONENT_DESIGN_REGISTRY,
): ContractIssue[] {
  const output: ContractIssue[] = [];
  for (const repeated of duplicates(registry.map((entry) => entry.codeId))) {
    output.push(issue('component.duplicate-id', 'Component code ID is duplicated.', repeated));
  }
  for (const entry of registry) {
    if (entry.states.length === 0 || duplicates(entry.states).length > 0) {
      output.push(
        issue('component.states', 'Component states must be non-empty and unique.', entry.codeId),
      );
    }
    for (const [axis, values] of Object.entries(entry.variants)) {
      if (values.length === 0 || duplicates(values).length > 0) {
        output.push(
          issue('component.variants', `Variant axis ${axis} is empty or duplicated.`, entry.codeId),
        );
      }
    }

    const pkg = packageName(entry.exportPath);
    const source = snapshot.sourceText[entry.exportPath];
    if (!source) {
      output.push(
        issue(
          'component.source-missing',
          'Component export path cannot be resolved.',
          entry.codeId,
        ),
      );
      continue;
    }
    if (pkg) {
      const exportName = entry.sourceContract?.exportName ?? entry.exportPath.split('#')[1];
      const index = snapshot.packageIndexes[pkg] ?? '';
      const exportPattern = new RegExp(`\\bdefault\\s+as\\s+${exportName}\\b`);
      if (!exportName || !exportPattern.test(index)) {
        output.push(
          issue(
            'component.package-export',
            'Package does not export the named component.',
            entry.codeId,
          ),
        );
      }
    }

    for (const [axis, contract] of Object.entries(entry.sourceContract?.variantTypes ?? {})) {
      const axisValues = entry.variants[axis];
      if (!axisValues) {
        output.push(
          issue(
            'component.contract-axis',
            `Source contract references missing axis ${axis}.`,
            entry.codeId,
          ),
        );
        continue;
      }
      const contractSource = contract.sourcePath
        ? snapshot.sourceText[contract.sourcePath]
        : source;
      const sourceValues = contractSource
        ? literalUnion(contractSource, contract.typeName)?.filter(
            (value) => !contract.exclude?.includes(value),
          )
        : undefined;
      if (!sourceValues) {
        output.push(
          issue(
            'component.contract-type',
            `Cannot resolve source union ${contract.typeName} for ${axis}.`,
            entry.codeId,
          ),
        );
      } else if (!sameValues(axisValues, sourceValues)) {
        output.push(
          issue(
            'component.contract-drift',
            `Variant ${axis} differs from source union ${contract.typeName}.`,
            entry.codeId,
          ),
        );
      }
    }
    for (const [axis, contract] of Object.entries(entry.sourceContract?.variantProperties ?? {})) {
      const axisValues = entry.variants[axis];
      const sourceValues = propertyValues(source, contract.propertyName);
      if (!axisValues || !sourceValues) {
        output.push(
          issue(
            'component.contract-property',
            `Cannot resolve source property ${contract.propertyName} for ${axis}.`,
            entry.codeId,
          ),
        );
      } else if (!sameValues(axisValues, sourceValues)) {
        output.push(
          issue(
            'component.contract-drift',
            `Variant ${axis} differs from source property ${contract.propertyName}.`,
            entry.codeId,
          ),
        );
      }
    }
  }
  return output;
}

function navPath(href: string): string {
  return href.split(/[?#]/, 1)[0] || '/';
}

function navPathCandidates(href: string): string[] {
  const path = navPath(href);
  const dynamicSuffix = path.lastIndexOf('[dynamic]');
  const attachedSuffix = dynamicSuffix > 0 && path[dynamicSuffix - 1] !== '/';
  return attachedSuffix ? [path, path.slice(0, dynamicSuffix)] : [path];
}

function routeShape(path: string): string {
  return path.replace(/\[(?:\.\.\.)?[^\]]+\]/g, '[param]');
}

export function validateNavReferences(
  references: readonly NavReference[],
  routes: readonly RouteDesignMeta[] = ROUTE_DESIGN_MANIFEST,
): ContractIssue[] {
  const output: ContractIssue[] = [];
  const known = new Set(routes.map((route) => route.pattern));
  const knownShapes = new Set(routes.map((route) => routeShape(route.pattern)));
  for (const reference of references) {
    const candidates = navPathCandidates(reference.href);
    if (candidates.includes('/')) continue; // hooks-level landing redirect, intentionally outside the screen manifest.
    if (!candidates.some((path) => known.has(path) || knownShapes.has(routeShape(path)))) {
      output.push(
        issue(
          'nav.unknown-href',
          `Navigation href ${reference.href} has no route contract (${reference.sourceFile}).`,
          reference.href,
        ),
      );
    }
  }
  return output;
}
