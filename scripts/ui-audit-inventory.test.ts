import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRouteInventory } from './ui-audit-inventory.mjs';
import baseline from '../tests/ui-audit/current-baseline.json';

describe('UI audit route inventory', () => {
  it('locks the complete endpoint ledger at 135 screens and 7 redirects', async () => {
    const inventory = await buildRouteInventory({ cleanBaseline: true });

    expect(inventory.summary).toMatchObject({ endpoints: 142, screens: 135, redirects: 7 });
    expect(new Set(inventory.routes.map((route) => route.pattern)).size).toBe(142);
    expect(
      inventory.routes.filter((route) => route.kind === 'redirect').map((route) => route.pattern),
    ).toEqual([
      '/ads',
      '/ads/[...path]',
      '/builder',
      '/crm/cleanup',
      '/pos',
      '/tools',
      '/workshop/[...path]',
    ]);
    expect(
      inventory.routes
        .filter((route) => route.kind === 'redirect')
        .every((route) => route.redirectContract),
    ).toBe(true);
    expect(inventory.sourceRef).toBe(baseline.sourceRef);
    expect(inventory.sourceCommit).toBe(baseline.sourceCommit);
    expect(inventory.workingTreeFingerprint).toBe(baseline.workingTreeFingerprint);
  });

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

    expect(inventory.summary).toMatchObject({ endpoints: 150, screens: 140, redirects: 10 });
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
