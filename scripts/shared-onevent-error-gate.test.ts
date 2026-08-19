// Local enforcement of the S0 gate from
// `2026-08-19-gateway-client-error-hook-consumer-adoption-spec` (Slice 1, hub).
//
// The spec forbids hub from bumping `@minion-stack/shared` until a *published*
// build actually exports `onEventError`, and requires hub's posture (wired vs
// accepted-default) to be on the record. Both halves drift silently otherwise:
// a routine dependency bump would quietly satisfy the gate while the decision
// record still claims the hook is unavailable. This test reads the installed
// package's own declarations — not a fixture — and holds the record in sync.
//
// Failure here means: the installed client build changed. Update
// docs/2026-08-19-gateway-onevent-error-hook-adoption.md's `Status:` line
// (`blocked-on-publish` → `adopted`) as part of that bump.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

const RECORD_PATH = 'docs/2026-08-19-gateway-onevent-error-hook-adoption.md';

const installedVersion = (JSON.parse(read('node_modules/@minion-stack/shared/package.json')) as {
  version: string;
}).version;
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

  it('does not wire onEventError against a build that cannot declare it', () => {
    const gatewaySource = read('src/lib/services/gateway.svelte.ts');

    if (hookDeclared) {
      // The hook shipped. Hub's recorded posture is accepted-default, so absence
      // is correct and presence would be a posture change — either way the record
      // above is what governs, and the first test enforces it.
      expect(recordedStatus).toBe('adopted');
      return;
    }

    // `onEventError` is not an option on the installed build, so passing it
    // would be an excess-property type error rather than a working report path.
    expect(gatewaySource).not.toMatch(/onEventError\s*[:(]/);
  });
});
