import path from 'node:path';

/** @typedef {{ path: string, source: string }} ClientArtifact */

/** @type {Array<readonly [string, RegExp]>} */
const MODULE_RULES = [
  ['Svelte server alias', /(?:^|[/\\])\$server(?:[/\\]|$)/i],
  ['server source', /(?:^|[/\\])src[/\\]server(?:[/\\]|$)/i],
  ['server library source', /(?:^|[/\\])src[/\\]lib[/\\]server(?:[/\\]|$)/i],
  [
    'SvelteKit server route',
    /(?:^|[/\\])(?:\+(?:page|layout)\.server|\+server|[^/\\]+\.server)\.[cm]?[jt]s(?:$|[?#])/i,
  ],
  ['SvelteKit server alias', /(?:^|[/\\])\$app[/\\]server(?:[/\\]|$)/i],
  ['private environment', /\$env[/\\](?:dynamic|static)[/\\]private/i],
  ['Node built-in', /^(?:__vite-browser-external:)?node:/i],
  ['PostgreSQL client', /[/\\]node_modules[/\\](?:\.bun[/\\])?postgres(?:@|[/\\])/i],
  ['QA seed executor', /(?:^|[/\\])scripts[/\\]qa[/\\]seed(?:[/\\]|$)/i],
  [
    'Supabase admin module',
    /supabase[^/\\]*(?:admin|service[-_]?role)|(?:admin|service[-_]?role)[^/\\]*supabase/i,
  ],
];

/** @type {Array<readonly [string, RegExp]>} */
const ARTIFACT_RULES = [
  ['private environment import', /\$env\/(?:dynamic|static)\/private/],
  ['Supabase service-role credential', /SUPABASE_SERVICE_ROLE_KEY/],
  ['Turso database credential', /TURSO_DB_AUTH_TOKEN/],
  ['native fixture database credential', /MINION_QC_DATABASE_URL/],
  ['QA seed executor', /scripts\/qa\/seed/],
];

/** @param {string} value */
function normalized(value) {
  return value.replaceAll('\\', '/').split('?')[0].replaceAll('\0', '');
}

/**
 * @param {readonly unknown[]} modules
 * @returns {string[]}
 */
export function clientModuleBoundaryViolations(modules) {
  const violations = [];
  for (const module of modules) {
    const id = normalized(String(module));
    for (const [label, rule] of MODULE_RULES) {
      if (
        (label === 'server source' || label === 'server library source') &&
        id.includes('/node_modules/')
      )
        continue;
      if (rule.test(id)) violations.push(`${label}: ${id}`);
    }
  }
  return [...new Set(violations)].sort();
}

/**
 * @param {readonly ClientArtifact[]} artifacts
 * @returns {string[]}
 */
export function clientArtifactBoundaryViolations(artifacts) {
  const violations = [];
  for (const artifact of artifacts) {
    const name = normalized(String(artifact.path));
    const source = String(artifact.source);
    for (const [label, rule] of ARTIFACT_RULES) {
      if (rule.test(source)) violations.push(`${label}: ${name}`);
    }
  }
  return [...new Set(violations)].sort();
}

/**
 * @param {{ label: string, modules: readonly unknown[], artifacts?: readonly ClientArtifact[] }} input
 */
export function assertClientBundleBoundary({ label, modules, artifacts = [] }) {
  const violations = [
    ...clientModuleBoundaryViolations(modules),
    ...clientArtifactBoundaryViolations(artifacts),
  ];
  if (violations.length > 0) {
    throw new Error(`${label} crossed the client/server boundary:\n${violations.join('\n')}`);
  }
  return {
    label,
    modules: modules.length,
    artifacts: artifacts.length,
    violations: 0,
  };
}

/**
 * @param {string} root
 * @param {string} file
 */
export function relativeClientModule(root, file) {
  return path.relative(root, file).replaceAll('\\', '/');
}
