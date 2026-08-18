import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REDIRECT_CONTRACTS = {
  '/ads': {
    probePath: '/ads?utm_source=ui-audit',
    statuses: [301],
    location: '/socials?utm_source=ui-audit',
    outcomes: ['preserves-query'],
  },
  '/ads/[...path]': {
    probePath: '/ads/campaigns/ui-audit?utm_source=ui-audit',
    statuses: [301],
    location: '/socials/campaigns/ui-audit?utm_source=ui-audit',
    outcomes: ['preserves-path', 'preserves-query'],
  },
  '/builder': {
    probePath: '/builder',
    statuses: [308],
    location: '/agents/builder',
    outcomes: ['legacy-route'],
  },
  '/crm/cleanup': {
    probePath: '/crm/cleanup',
    statuses: [308],
    location: '/crm/settings?tab=hygiene',
    outcomes: ['preserves-tab-target'],
  },
  '/pos': {
    probePath: '/pos',
    statuses: [302, 403],
    locations: ['/pos/sell', '/pos/appointments', '/pos/catalog', '/pos/refills'],
    outcomes: ['first-permitted-child', 'permission-denied'],
  },
  '/shells': {
    probePath: '/shells?source=ui-audit',
    statuses: [307],
    location: '/cloud?source=ui-audit',
    outcomes: ['preserves-query', 'legacy-route'],
  },
  '/shells/[shellId]': {
    probePath: '/shells/ui-audit-shell',
    statuses: [307],
    location: '/cloud?server=ui-audit-shell',
    outcomes: ['preserves-parameter', 'legacy-route'],
  },
  '/tools': {
    probePath: '/tools',
    statuses: [307],
    location: '/capabilities?tab=tools',
    outcomes: ['preserves-tab-target'],
  },
  '/terminal': {
    probePath: '/terminal?server=ui-audit-shell',
    statuses: [307],
    location: '/cloud/terminal?server=ui-audit-shell',
    outcomes: ['preserves-query', 'legacy-route'],
  },
  '/workshop/[...path]': {
    probePath: '/workshop/ui-audit',
    statuses: [308],
    location: '/agents/workshop/ui-audit',
    outcomes: ['preserves-path'],
  },
};

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else files.push(absolute);
  }
  return files;
}

function routePath(relative) {
  const directory = path.dirname(relative).split(path.sep);
  const segments = directory.filter((segment) => !/^\(.+\)$/.test(segment));
  return segments.length ? `/${segments.join('/')}` : '/';
}

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function isUnconditionalServerRedirect(source) {
  const loadBody = source.match(/\bexport\s+const\s+load\b[\s\S]*?=>\s*\{([\s\S]*?)\n\};?/);
  if (!loadBody) return false;
  return /^\s*throw\s+redirect\s*\(/.test(loadBody[1]);
}

async function recordedBaselineRef(root) {
  try {
    const ledger = JSON.parse(
      await readFile(path.join(root, 'tests/ui-audit/current-baseline.json'), 'utf8'),
    );
    if (typeof ledger.sourceCommit === 'string' && /^[0-9a-f]{40}$/.test(ledger.sourceCommit)) {
      git(root, 'cat-file', '-e', `${ledger.sourceCommit}^{commit}`);
      return ledger.sourceCommit;
    }
  } catch {
    // A new repository has no ledger yet; its current commit becomes baseline.
  }
  return 'HEAD';
}

/**
 * Build the route inventory either from the mutable working tree or from an
 * immutable Git object. The latter is what backs the pre-program evidence: a
 * dirty route file must never be able to rewrite what we call the baseline.
 */
export async function buildRouteInventory({
  cleanBaseline = false,
  baselineRef,
  repositoryRoot = ROOT,
} = {}) {
  const root = path.resolve(repositoryRoot);
  const routeRoot = path.join(root, 'src/routes');
  const headCommit = git(root, 'rev-parse', 'HEAD');
  const cleanSourceRef = baselineRef ?? (await recordedBaselineRef(root));
  const sourceCommit = cleanBaseline ? git(root, 'rev-parse', cleanSourceRef) : headCommit;
  const sourceRef = cleanBaseline ? cleanSourceRef : 'WORKTREE';
  const trackedRouteFiles = cleanBaseline
    ? git(root, 'ls-tree', '-r', '--name-only', sourceCommit, '--', 'src/routes')
        .split('\n')
        .filter(Boolean)
    : (await walk(routeRoot)).map((file) => path.relative(root, file).split(path.sep).join('/'));
  const routeFiles = trackedRouteFiles.filter((file) =>
    /(?:^|\/)\+page(?:\.server)?\.(?:svelte|[jt]s)$/.test(file),
  );
  const routeDirectories = [...new Set(routeFiles.map((file) => path.posix.dirname(file)))].sort();
  const readSource = (relativeFile) =>
    cleanBaseline
      ? Promise.resolve(git(root, 'show', `${sourceCommit}:${relativeFile}`))
      : readFile(path.join(root, ...relativeFile.split('/')), 'utf8');
  const routes = [];
  for (const directory of routeDirectories) {
    const entries = routeFiles
      .filter((file) => path.posix.dirname(file) === directory)
      .map((file) => path.posix.basename(file))
      .sort();
    const pageFile = entries.includes('+page.svelte')
      ? path.posix.join(directory, '+page.svelte')
      : null;
    const sourceFile = pageFile ?? path.posix.join(directory, entries[0]);
    const relative = path.posix.relative('src/routes', sourceFile);
    const sources = [];
    for (const entry of entries) sources.push(await readSource(path.posix.join(directory, entry)));
    const source = sources.join('\n');
    const universalLoadSource = await Promise.all(
      entries
        .filter((entry) => /^\+page\.[jt]s$/.test(entry))
        .map((entry) => readSource(path.posix.join(directory, entry))),
    );
    const serverLoadSource = await Promise.all(
      entries
        .filter((entry) => /^\+page\.server\.[jt]s$/.test(entry))
        .map((entry) => readSource(path.posix.join(directory, entry))),
    );
    const pattern = routePath(relative);
    // A page with renderable markup remains a screen even if its server load
    // conditionally redirects unauthenticated or unconfigured users. Redirect
    // endpoints are server-only routes plus legacy shim pages whose universal
    // load, or first server-load statement, always redirects. Conditional
    // server redirects do not hide otherwise renderable page markup.
    const kind =
      !pageFile ||
      universalLoadSource.some((entry) => /\bredirect\s*\(/.test(entry)) ||
      serverLoadSource.some(isUnconditionalServerRedirect)
        ? 'redirect'
        : 'screen';
    routes.push({
      id:
        pattern === '/'
          ? 'root'
          : pattern
              .slice(1)
              .replace(/[^a-z0-9]+/gi, '.')
              .replace(/^\.|\.$/g, ''),
      pattern,
      source: sourceFile,
      family: relative.startsWith('(app)/') ? 'app' : 'public',
      kind,
      dynamic: /\[[^\]]+\]/.test(pattern),
      ...(kind === 'redirect' ? { redirectContract: REDIRECT_CONTRACTS[pattern] ?? null } : {}),
      observations: {
        pageHeader: /<PageHeader\b/.test(source),
        explicitResponsiveRule: /(?:sm|md|lg|xl|2xl):|@media\b|@container\b/.test(source),
        nativeButtons: (source.match(/<button\b/g) ?? []).length,
        nativeInputs: (source.match(/<input\b/g) ?? []).length,
        fetchSites: (source.match(/\bfetch\s*\(/g) ?? []).length,
      },
    });
  }
  const status = cleanBaseline ? '' : git(root, 'status', '--short', '--untracked-files=all');
  const sourceTreeSha = git(root, 'rev-parse', `${sourceCommit}:src/routes`);
  const fingerprint = cleanBaseline
    ? `git:${sourceCommit}:${sourceTreeSha}`
    : createHash('sha256')
        .update(status)
        .update(git(root, 'diff', '--binary'))
        .digest('hex');
  const screens = routes.filter((route) => route.kind === 'screen');
  return {
    schemaVersion: 1,
    baseCommit: headCommit,
    sourceRef,
    sourceCommit,
    sourceTreeSha,
    workingTreeFingerprint: fingerprint,
    summary: {
      endpoints: routes.length,
      screens: screens.length,
      redirects: routes.length - screens.length,
      dynamicScreens: screens.filter((route) => route.dynamic).length,
      appScreens: screens.filter((route) => route.family === 'app').length,
      publicScreens: screens.filter((route) => route.family === 'public').length,
    },
    knownBaselineFailures: [
      {
        id: 'UI-001',
        observation: 'Agent wizard created a gateway ID then opened the Hub draft editor with it.',
      },
      {
        id: 'UI-002',
        observation:
          'Builder agents and skills lacked complete capability and ownership enforcement.',
      },
      {
        id: 'UI-003',
        observation: 'Global search queried record types without effective view/owner policy.',
      },
      {
        id: 'UI-007',
        observation:
          'Command visibility used optional route metadata instead of the executable route guard.',
      },
    ],
    routes,
  };
}

async function main() {
  const outputArg = process.argv.find((arg) => arg.startsWith('--out='));
  const baselineRefArg = process.argv.find((arg) => arg.startsWith('--baseline-ref='));
  const output = path.resolve(
    ROOT,
    outputArg?.slice('--out='.length) ?? 'test-results/ui-audit/route-inventory.json',
  );
  const inventory = await buildRouteInventory({
    cleanBaseline: process.argv.includes('--clean-baseline'),
    baselineRef: baselineRefArg?.slice('--baseline-ref='.length),
  });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(inventory, null, 2)}\n`);
  console.log(
    `UI route inventory: ${inventory.summary.screens} screens, ${inventory.summary.redirects} redirects → ${path.relative(ROOT, output)}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
