/**
 * Page accessibility evidence (spec 137, FR-001): one axe-core pass per captured
 * scenario, after the page settled, limited to the WCAG A/AA tags in
 * `tests/ui-audit/a11y-tags.json` (the same list the story gate filters by).
 * `scripts/a11y.mjs` turns the counts into the decrease-only ledger.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';

export interface A11yRuleEvidence {
  /** Elements breaking the rule (axe nodes). */
  count: number;
  impact: string | null;
  /** First few offending selectors; the ledger keeps only `count`. */
  offenders: string[];
}
/** axe rule id → evidence; an empty object is a clean page. */
export type A11yEvidence = Record<string, A11yRuleEvidence>;

const TAGS: string[] = JSON.parse(readFileSync('tests/ui-audit/a11y-tags.json', 'utf8'));
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);

export async function collectA11y(page: Page): Promise<A11yEvidence> {
  // Evaluated over CDP (not a <script> tag), so the app's CSP cannot block it.
  await page.evaluate(AXE_SOURCE);
  const violations = await page.evaluate(async (tags) => {
    const axe = (
      window as unknown as {
        axe: {
          run(
            context: Document,
            options: object,
          ): Promise<{
            violations: { id: string; impact: string | null; nodes: { target: unknown[] }[] }[];
          }>;
        };
      }
    ).axe;
    const result = await axe.run(document, {
      runOnly: { type: 'tag', values: tags },
      resultTypes: ['violations'],
    });
    return result.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }));
  }, TAGS);
  return Object.fromEntries(
    violations
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((violation) => [
        violation.id,
        {
          count: violation.targets.length,
          impact: violation.impact,
          offenders: violation.targets.slice(0, 5),
        },
      ]),
  );
}
