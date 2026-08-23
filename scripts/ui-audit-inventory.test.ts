import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildRouteInventory } from './ui-audit-inventory.mjs';
import baseline from '../tests/ui-audit/current-baseline.json';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * The pinned baseline commit is a real Git object in a full clone (CI checks out
 * with `fetch-depth: 0`) but is absent from a SHALLOW checkout — which is what
 * factory workers and any `--depth` clone get. `buildRouteInventory` then falls
 * back to HEAD, so the route ledger below is still certified against committed
 * sources; only the provenance identity is unverifiable. Skip that assertion
 * loudly instead of handing back the recorded ledger and comparing it to itself.
 */
const pinnedBaselineIsReachable = (() => {
  try {
    execFileSync('git', ['cat-file', '-e', `${baseline.sourceCommit}^{commit}`], {
      cwd: repositoryRoot,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
})();

describe('UI audit route inventory', () => {
  it('locks the complete endpoint ledger at 138 screens and 10 redirects', async () => {
    const inventory = await buildRouteInventory({ cleanBaseline: true });

    expect(inventory.summary).toMatchObject({ endpoints: 148, screens: 138, redirects: 10 });
    expect(new Set(inventory.routes.map((route) => route.pattern)).size).toBe(148);
    expect(
      inventory.routes.filter((route) => route.kind === 'redirect').map((route) => route.pattern),
    ).toEqual([
      '/ads',
      '/ads/[...path]',
      '/builder',
      '/crm/cleanup',
      '/pos',
      '/shells',
      '/shells/[shellId]',
      '/terminal',
      '/tools',
      '/workshop/[...path]',
    ]);
    expect(
      inventory.routes
        .filter((route) => route.kind === 'redirect')
        .every((route) => route.redirectContract),
    ).toBe(true);
  });

  it.runIf(pinnedBaselineIsReachable)(
    'certifies that ledger against the pinned baseline commit, not the working tree',
    async () => {
      const inventory = await buildRouteInventory({ cleanBaseline: true });

      expect(inventory.sourceRef).toBe(baseline.sourceRef);
      expect(inventory.sourceCommit).toBe(baseline.sourceCommit);
      expect(inventory.workingTreeFingerprint).toBe(baseline.workingTreeFingerprint);
    },
  );

  it('reads clean baseline evidence from the recorded Git object, not dirty route files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'minion-ui-inventory-'));
    const routeFile = path.join(root, 'src/routes/example/+page.svelte');
    try {
      await mkdir(path.dirname(routeFile), { recursive: true });
      await writeFile(routeFile, '<h1>Tracked screen</h1>\n');
      execFileSync('git', ['init', '--quiet'], { cwd: root });
      execFileSync('git', ['add', '.'], { cwd: root });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=UI Audit',
          '-c',
          'user.email=ui-audit@minion.test',
          'commit',
          '--quiet',
          '-m',
          'baseline',
        ],
        { cwd: root },
      );

      const before = await buildRouteInventory({ cleanBaseline: true, repositoryRoot: root });
      await writeFile(routeFile, '<h1>Dirty screen</h1><button>Uncommitted action</button>\n');
      const after = await buildRouteInventory({ cleanBaseline: true, repositoryRoot: root });
      const workingTree = await buildRouteInventory({ repositoryRoot: root });

      expect(after).toEqual(before);
      expect(after.sourceRef).toBe('HEAD');
      expect(after.sourceCommit).toMatch(/^[0-9a-f]{40}$/);
      expect(after.workingTreeFingerprint).toBe(`git:${after.sourceCommit}:${after.sourceTreeSha}`);
      expect(workingTree.routes[0].observations.nativeButtons).toBe(1);
      expect(workingTree.workingTreeFingerprint).not.toBe(after.workingTreeFingerprint);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('classifies the rendered legacy terminal shim by its unconditional server redirect', async () => {
    const inventory = await buildRouteInventory();
    const terminal = inventory.routes.find((route) => route.pattern === '/terminal');

    // Unlike the pinned-commit ledger above, this reads the WORKTREE (no
    // cleanBaseline flag), so it reflects the route surface at HEAD-with-
    // uncommitted-changes, not the immutable pre-program commit.
    expect(inventory.summary).toMatchObject({ endpoints: 148, screens: 138, redirects: 10 });
    expect(terminal).toMatchObject({
      kind: 'redirect',
      source: 'src/routes/(app)/terminal/+page.svelte',
      redirectContract: {
        location: '/cloud/terminal?server=ui-audit-shell',
        outcomes: ['preserves-query', 'legacy-route'],
      },
    });
  });
});
