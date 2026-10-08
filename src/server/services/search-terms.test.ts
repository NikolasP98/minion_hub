import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  searchTokens,
  foldAccents,
  tokenizedIlike,
  ACCENT_FOLD_FROM,
  ACCENT_FOLD_TO,
} from './search-terms';

describe('searchTokens', () => {
  it('folds accents and lowercases', () => {
    expect(searchTokens('RONDÓN')).toEqual(['rondon']);
  });

  it('splits on whitespace and drops empties', () => {
    expect(searchTokens('  leyla   rondon  ')).toEqual(['leyla', 'rondon']);
  });

  it('caps at 8 tokens', () => {
    expect(searchTokens('a b c d e f g h i j')).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('is empty for blank input', () => {
    expect(searchTokens('')).toEqual([]);
    expect(searchTokens('   ')).toEqual([]);
  });
});

describe('ACCENT_FOLD_FROM / ACCENT_FOLD_TO', () => {
  it('are the same length (translate() maps pairwise)', () => {
    expect(ACCENT_FOLD_FROM.length).toBe(ACCENT_FOLD_TO.length);
  });
});

describe('tokenizedIlike', () => {
  function render(node: ReturnType<typeof sql>) {
    return new PgDialect().sqlToQuery(node);
  }

  it('returns undefined for no tokens', () => {
    expect(tokenizedIlike([sql`name`], '')).toBeUndefined();
    expect(tokenizedIlike([sql`name`], '   ')).toBeUndefined();
  });

  it('returns undefined when no columns are given', () => {
    expect(tokenizedIlike([], 'leyla')).toBeUndefined();
  });

  it('ANDs tokens and ORs columns', () => {
    const cond = tokenizedIlike([sql`name`, sql`email`], 'leyla rondon');
    const query = render(cond!);
    expect(query.sql).toContain(' and ');
    // 2 tokens x 2 columns = 4 `like` comparisons
    expect(query.sql.match(/ like /g)?.length).toBe(4);
    // Each token's pattern is bound once per column (2 columns here).
    expect(query.params.filter((p) => p === '%leyla%')).toHaveLength(2);
    expect(query.params.filter((p) => p === '%rondon%')).toHaveLength(2);
  });

  it('escapes LIKE metacharacters in a token', () => {
    const cond = tokenizedIlike([sql`name`], '50%_\\x');
    const query = render(cond!);
    expect(query.params).toContain('%50\\%\\_\\\\x%');
  });
});
