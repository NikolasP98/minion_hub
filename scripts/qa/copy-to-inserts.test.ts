import { describe, expect, it } from 'vitest';
import { copyBlocksToInserts } from './copy-to-inserts';

describe('copyBlocksToInserts', () => {
  it('converts a COPY block into one INSERT per row', () => {
    const raw = [
      'COPY public.hub_migrations (version, applied_at) FROM stdin;',
      '20260101000000\t2026-01-01 00:00:00.123456+00',
      '20260202000000\t2026-02-02 12:34:56+00',
      '\\.',
      '',
    ].join('\n');

    expect(copyBlocksToInserts(raw)).toBe(
      [
        "INSERT INTO public.hub_migrations (version, applied_at) VALUES ('20260101000000', '2026-01-01 00:00:00.123456+00');",
        "INSERT INTO public.hub_migrations (version, applied_at) VALUES ('20260202000000', '2026-02-02 12:34:56+00');",
        '',
      ].join('\n'),
    );
  });

  it('passes non-COPY text through unchanged', () => {
    const raw = ['CREATE TABLE public.t (id int);', 'GRANT SELECT ON public.t TO app_ledger;'].join(
      '\n',
    );
    expect(copyBlocksToInserts(raw)).toBe(raw);
  });

  it('leaves already-INSERT ledger.sql (the --inserts snapshot format) untouched', () => {
    const raw =
      "INSERT INTO public.hub_migrations (version, applied_at) VALUES ('20260101000000', '2026-01-01 00:00:00+00');";
    expect(copyBlocksToInserts(raw)).toBe(raw);
  });

  it('turns the \\N marker into SQL NULL', () => {
    const raw = ['COPY public.t (a, b) FROM stdin;', 'x\t\\N', '\\.'].join('\n');
    expect(copyBlocksToInserts(raw)).toBe("INSERT INTO public.t (a, b) VALUES ('x', NULL);");
  });

  it('un-escapes tab, newline and backslash within a field', () => {
    const raw = ['COPY public.t (a) FROM stdin;', 'line1\\nline2\\tend\\\\slash', '\\.'].join('\n');
    expect(copyBlocksToInserts(raw)).toBe(
      "INSERT INTO public.t (a) VALUES ('line1\nline2\tend\\slash');",
    );
  });

  it('escapes a single quote inside a field value for the SQL literal', () => {
    const raw = ['COPY public.t (a) FROM stdin;', "it's here", '\\.'].join('\n');
    expect(copyBlocksToInserts(raw)).toBe("INSERT INTO public.t (a) VALUES ('it''s here');");
  });

  it('round-trips all 87 rows of a realistic hub_migrations COPY block — no tail truncation', () => {
    // Regression for a 2026-09-16 incident: a restored QA stack ended up with
    // only 84/87 ledger rows and db-migrate.ts silently (idempotently)
    // re-applied the 3 missing ones. copyBlocksToInserts wasn't in that
    // restore's actual path (psql read the file directly), but it's the
    // shared, testable stand-in for "does every COPY data line survive" —
    // pin it at the real row count so a future off-by-N in the block-walking
    // loop (or in whatever replaces it) can't reintroduce silent data loss.
    const rows = Array.from({ length: 87 }, (_, i) => {
      const version = String(20260101000000 + i * 10000).padStart(14, '0');
      const appliedAt = `2026-01-01 00:00:${String(i % 60).padStart(2, '0')}.123456+00`;
      return `${version}\t${appliedAt}`;
    });
    const raw = [
      'COPY public.hub_migrations (version, applied_at) FROM stdin;',
      ...rows,
      '\\.',
      '',
    ].join('\n');

    const result = copyBlocksToInserts(raw);
    const inserted = result.split('\n').filter((line) => line.startsWith('INSERT INTO'));

    expect(inserted).toHaveLength(87);
    for (const row of rows) {
      const [version, appliedAt] = row.split('\t');
      expect(inserted).toContain(
        `INSERT INTO public.hub_migrations (version, applied_at) VALUES ('${version}', '${appliedAt}');`,
      );
    }
  });

  it('handles multiple COPY blocks in one file', () => {
    const raw = [
      'COPY public.a (x) FROM stdin;',
      '1',
      '\\.',
      '-- something in between',
      'COPY public.b (y) FROM stdin;',
      '2',
      '\\.',
    ].join('\n');
    expect(copyBlocksToInserts(raw)).toBe(
      [
        "INSERT INTO public.a (x) VALUES ('1');",
        '-- something in between',
        "INSERT INTO public.b (y) VALUES ('2');",
      ].join('\n'),
    );
  });
});
