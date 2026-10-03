import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import inventory from '../../../tests/fixtures/card-actions/record-url-inventory.json';

describe('reviewed direct card consumer URL inventory', () => {
  it('covers every classified API and programmatic destination builder', () => {
    expect(inventory).toHaveLength(14);
    expect(inventory.flatMap((entry) => entry.urls)).toHaveLength(48);
    expect(
      inventory.flatMap((entry) => entry.urls).filter((url) => url.startsWith('/api/')),
    ).toHaveLength(43);
    for (const entry of inventory) {
      const source = readFileSync(entry.path, 'utf8');
      const urls = [...source.matchAll(/`([^`]+)`/g)]
        .map((match) => match[1])
        .filter(
          (url) =>
            /^\/(api\/(builder|flows|workshop)|agents\/builder|flow-editor|tools|agents\/workshop)(\/|$)/.test(
              url,
            ) && url.includes('${'),
        );
      expect(urls, entry.path).toEqual(entry.urls);
      for (const url of urls) {
        for (const [, expression] of url.matchAll(/\$\{([^}]+)\}/g)) {
          // BuilderHub's domain segment is a closed skills/agents/tools switch;
          // all dynamic record/chapter IDs must cross the same URL boundary.
          if (expression === 'path' && entry.path.endsWith('/BuilderHub.svelte')) continue;
          expect(expression, `${entry.path}: ${url}`).toMatch(/^recordPathSegment\([^()]+\)$/);
        }
      }
    }
  });
});
