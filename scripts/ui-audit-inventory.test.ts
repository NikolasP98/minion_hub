import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRouteInventory } from './ui-audit-inventory.mjs';
import baseline from '../tests/ui-audit/current-baseline.json';

type LedgerRoute = {
  id: string;
  pattern: string;
  source: string;
  family: string;
  kind: string;
  dynamic: boolean;
  redirectContract?: Record<string, unknown>;
};

/** Every field of a route that is a contract, with the audit metrics dropped. */
const endpointSurface = (routes: readonly LedgerRoute[]) =>
  routes.map(({ id, pattern, source, family, kind, dynamic, redirectContract }) => ({
    id,
    pattern,
    source,
    family,
    kind,
    dynamic,
    redirectContract: redirectContract ?? null,
  }));

describe('UI audit route inventory', () => {
  it('locks the complete endpoint ledger at 142 screens and 10 redirects', async () => {
    const inventory = await buildRouteInventory({ cleanBaseline: true });

    expect(inventory.summary).toMatchObject({ endpoints: 152, screens: 142, redirects: 10 });
    expect(new Set(inventory.routes.map((route) => route.pattern)).size).toBe(152);
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
    // The ledger locks the ENDPOINT SURFACE, not the commit it happened to be
    // generated on. `sourceCommit` / `sourceRef` / `workingTreeFingerprint` are
    // provenance: a squash-merge deletes the branch commit a regeneration
    // recorded and a shallow clone never had it, so asserting equality on those
    // ids failed on every unrelated PR — and on the rare clone where the id did
    // resolve, it passed vacuously by rebuilding the inventory from the very
    // commit the ledger was written from. `observations` are audit metrics
    // (button/input/fetch counts) that legitimately move when route markup is
    // edited, so they are regenerated rather than locked.
    expect(endpointSurface(inventory.routes)).toEqual(
      endpointSurface(baseline.routes as unknown as LedgerRoute[]),
    );
    expect(inventory.summary).toEqual(baseline.summary);
    expect(inventory.workingTreeFingerprint).toBe(
      `git:${inventory.sourceCommit}:${inventory.sourceTreeSha}`,
    );
  });

  it('reads clean baseline evidence from the committed Git object, not dirty route files', async () => {
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

    expect(inventory.summary).toMatchObject({ endpoints: 152, screens: 142, redirects: 10 });
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
