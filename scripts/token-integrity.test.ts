import { describe, expect, it } from 'vitest';
import {
  auditTokenSources,
  extractVarConsumers,
  FORBIDDEN_LEGACY_TOKENS,
  scanTokenIntegrity,
} from './token-integrity.mjs';

describe('token-integrity scanner', () => {
  it('parses nested var consumers and records fallback intent', () => {
    const consumers = extractVarConsumers(
      '.card { color: var(--known, var(--optional, red)); }',
      'src/card.css',
    );
    expect(consumers.map(({ token, hasFallback }) => ({ token, hasFallback }))).toEqual([
      { token: '--known', hasFallback: true },
      { token: '--optional', hasFallback: true },
    ]);
  });

  it('rejects undefined names even when a literal fallback hides the defect', () => {
    const result = auditTokenSources({
      sources: [{ file: 'src/card.css', text: '.card { color: var(--typo, red); }' }],
    });
    expect(result.unresolved).toEqual([
      expect.objectContaining({ token: '--typo', kind: 'undefined-consumer', hasFallback: true }),
    ]);
  });

  it('rejects forbidden legacy names even when locally declared', () => {
    const result = auditTokenSources({
      sources: [
        {
          file: 'src/card.css',
          text: ':root { --color-error: red; } .card { color: var(--color-error, red); }',
        },
      ],
    });
    expect(result.unresolved.map((item) => item.kind)).toEqual([
      'forbidden-definition',
      'forbidden-consumer',
    ]);
  });

  it('recognizes contract, CSS, runtime-authored, and reason-coded component inputs', () => {
    const result = auditTokenSources({
      contractTokens: new Set(['--color-accent']),
      sources: [
        {
          file: 'src/lib/components/data-table/DataTable.svelte',
          text: `<div style:--row-height={'2rem'}></div><style>
            .row { --local: 1; color: var(--color-accent); gap: var(--local); height: var(--row-height); }
            .agg { color: var(--dt-agg-color, var(--color-accent)); }
          </style>`,
        },
      ],
    });
    expect(result.unresolved).toEqual([]);
    expect(result.reasonCoded.map((item) => item.reason).sort()).toEqual([
      'component-input',
      'runtime-authored',
    ]);
  });

  it('keeps the checked-in Hub free of undefined and retired consumers', () => {
    const result = scanTokenIntegrity();
    expect(result.unresolved).toEqual([]);
    expect(
      result.consumers.filter((consumer) => FORBIDDEN_LEGACY_TOKENS.has(consumer.token)),
    ).toEqual([]);
  });
});
