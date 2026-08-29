// Local enforcement of the S0 gate from
// `2026-08-19-gateway-client-error-hook-consumer-adoption-spec` (Slice 1, hub).
//
// The spec forbids hub from bumping `@minion-stack/shared` until a *published*
// build actually exports `onEventError`, and requires hub's posture (wired vs
// accepted-default) to be on the record. Both halves drift silently otherwise:
// a routine dependency bump would quietly satisfy the gate while the decision
// record still claims the hook is unavailable. These tests read the installed
// package's own declarations and hub's own source — not fixtures — so the record
// cannot get out of step with what ships.
//
// Failure of the first test means: the installed client build changed. Update
// docs/2026-08-19-gateway-onevent-error-hook-adoption.md's `Status:` line
// (`blocked-on-publish` → `adopted`) as part of that bump.
//
// TODO(handoff): Slice 1's DEPENDENCY adoption is still not done — `package.json`
// pins `@minion-stack/shared` at `^0.9.0` and no published build declares
// `onEventError` (registry re-polled 2026-08-29: latest is still 0.10.0,
// published 2026-08-13, and its `dist/gateway/client.d.ts` has `onEvent?:`
// only; the hook and its changeset are still only on minion-meta's `dev`
// branch, with no `dev` → `main` promotion PR open). It
// cannot be done from this repo: it waits on an external publish from
// minion-meta. This gate is the enforcement site because `package.json` cannot
// carry a comment; the exact remaining steps, evidence, and ledger pointer are
// in docs/2026-08-19-gateway-onevent-error-hook-adoption.md §1 and §4, whose
// open-items ledger is minion-meta
// `proposals/2026-08-17-gateway-client-error-hook-consumer-adoption.md`.
// The behavioural half of the slice is NOT deferred: hub contains handler
// failures itself in `src/lib/services/gateway/event-dispatch.ts`, and the third
// test below keeps that wired.

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
const hookDeclared = /\bonEventError\b/.test(
  read('node_modules/@minion-stack/shared/dist/gateway/client.d.ts'),
);
const recordedStatus = read(RECORD_PATH).match(/^- \*\*Status:\*\* `([a-z-]+)`$/m)?.[1];

describe('@minion-stack/shared onEventError adoption gate', () => {
  it('keeps the recorded posture in sync with the installed client declarations', () => {
    expect(
      recordedStatus,
      `@minion-stack/shared@${installedVersion} ${hookDeclared ? 'declares' : 'does not declare'} ` +
        `onEventError — reconcile the "- **Status:** \`…\`" line in ${RECORD_PATH}`,
    ).toBe(hookDeclared ? 'adopted' : 'blocked-on-publish');
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
