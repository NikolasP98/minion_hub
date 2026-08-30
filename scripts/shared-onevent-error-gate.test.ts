// Local enforcement of the adoption contract from
// `2026-08-19-gateway-client-error-hook-consumer-adoption-spec` (Slice 1, hub).
//
// The installed registry build must export all three lifecycle-error hooks,
// hub's decision record must say `adopted`, and the source must preserve the
// explicit posture chosen for each hook. These tests read shipped declarations
// and source rather than mirroring either implementation in a fixture.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

const RECORD_PATH = 'docs/2026-08-19-gateway-onevent-error-hook-adoption.md';

const installedPackage = JSON.parse(read('node_modules/@minion-stack/shared/package.json')) as {
  version: string;
};
const installedVersion = installedPackage.version;
const clientDeclarations = read('node_modules/@minion-stack/shared/dist/gateway/client.d.ts');
const hookDeclared = /\bonEventError\b/.test(clientDeclarations);
const recordedStatus = read(RECORD_PATH).match(/^- \*\*Status:\*\* `([a-z-]+)`$/m)?.[1];

describe('@minion-stack/shared onEventError adoption gate', () => {
  it('keeps the recorded posture in sync with the installed client declarations', () => {
    expect(
      recordedStatus,
      `@minion-stack/shared@${installedVersion} ${hookDeclared ? 'declares' : 'does not declare'} ` +
        `onEventError — reconcile the "- **Status:** \`…\`" line in ${RECORD_PATH}`,
    ).toBe(hookDeclared ? 'adopted' : 'blocked-on-publish');
  });

  it('pins the exact published hook-bearing release and all sibling hooks', () => {
    const manifest = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };

    expect(manifest.dependencies['@minion-stack/shared']).toBe('0.11.0');
    expect(installedVersion).toBe('0.11.0');
    expect(clientDeclarations).toMatch(/\bonEventError\b/);
    expect(clientDeclarations).toMatch(/\bonReconnectError\b/);
    expect(clientDeclarations).toMatch(/\bonSocketError\b/);
  });

  it('keeps the blocked slice recorded as blocked, not as completed S1', () => {
    if (hookDeclared) return; // Covered by the status test above once the bump lands.

    // S1 as written IS the dependency bump, and it is not made here. Three
    // reviews read the branch as claiming otherwise, so the disclaimer is part
    // of the record's contract rather than incidental prose: a rewrite that
    // drops it while the dependency is still pinned pre-hook flips this red.
    expect(
      read(RECORD_PATH),
      `${RECORD_PATH} must keep stating that this branch does not complete S1's dependency adoption ` +
        `while @minion-stack/shared@${installedVersion} cannot declare onEventError`,
    ).toContain("does not complete Slice 1's dependency adoption");
  });

  it('does not wire onEventError against a build that cannot declare it', () => {
    const gatewaySource = read('src/lib/services/gateway.svelte.ts');

    if (hookDeclared) {
      // The hook shipped. Hub's recorded posture is accepted-default, so absence
      // is correct and presence would be a posture change — either way the record
      // above is what governs, and the first test enforces it.
      expect(recordedStatus).toBe('adopted');
      return;
    }

    // `onEventError` is not an option on the installed build, so passing it would
    // be an excess-property type error rather than a working report path.
    expect(gatewaySource).not.toMatch(/onEventError\s*[:(]/);
  });

  it('records explicit silent postures for redundant lifecycle reports', () => {
    const gatewaySource = read('src/lib/services/gateway.svelte.ts');

    expect(gatewaySource).toMatch(/onReconnectError:\s*\(\)\s*=>\s*\{\}/);
    expect(gatewaySource).toMatch(/onSocketError:\s*\(\)\s*=>\s*\{\}/);
  });

  it('keeps hub containing its own handler failures regardless of the gate', () => {
    // The accepted-default posture (record §3b) never makes the shared client the
    // ONLY guard: hub contains failures at its own dispatch site (§3a) so the
    // event path is safe on the pre-hook client too. A bump that "adopts" the
    // hook by deleting this containment would silently regress both loss modes,
    // so pin the wiring here rather than trusting the record's prose.
    const gatewaySource = read('src/lib/services/gateway.svelte.ts');

    expect(gatewaySource).toContain("from './gateway/event-dispatch'");
    expect(gatewaySource).toMatch(/dispatchGatewayEvent\(\s*frame[^)]*,\s*handleEvent\s*\)/);
    // …and never the raw call it replaced.
    expect(gatewaySource).not.toMatch(/^\s*handleEvent\(frame/m);
  });
});
