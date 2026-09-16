import { describe, expect, it } from 'vitest';
import { sanitizeDump } from './snapshot-sanitize';

describe('sanitizeDump', () => {
  it('drops pg_dump preamble comments and SET/search_path noise', () => {
    const raw = [
      '--',
      '-- PostgreSQL database dump',
      '--',
      'SET statement_timeout = 0;',
      'SET lock_timeout = 0;',
      "SET client_encoding = 'UTF8';",
      "SELECT pg_catalog.set_config('search_path', '', false);",
      '',
      'CREATE TABLE public.crm_contacts (',
      '    id uuid NOT NULL',
      ');',
    ].join('\n');

    // Leading blank line left where the preamble used to be is harmless and
    // intentionally not trimmed — only DROP_PATTERNS lines are removed.
    expect(sanitizeDump(raw)).toBe(
      ['', 'CREATE TABLE public.crm_contacts (', '    id uuid NOT NULL', ');'].join('\n') + '\n',
    );
  });

  it('keeps SET check_function_bodies = false; — dropping it breaks restoring a function defined before its table', () => {
    const raw = [
      'SET statement_timeout = 0;',
      'SET check_function_bodies = false;',
      'SET xmloption = content;',
      'CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;',
    ].join('\n');

    expect(sanitizeDump(raw)).toBe(
      [
        'SET check_function_bodies = false;',
        'CREATE FUNCTION public.f() RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;',
      ].join('\n') + '\n',
    );
  });

  it('drops \\restrict and \\unrestrict lines emitted by pg_dump >=17', () => {
    const raw = [
      '\\restrict ab12cd34ef',
      'CREATE TABLE public.t (id int);',
      '\\unrestrict ab12cd34ef',
    ].join('\n');

    expect(sanitizeDump(raw)).toBe('CREATE TABLE public.t (id int);\n');
  });

  it('trims trailing whitespace without touching content', () => {
    const raw =
      'CREATE TABLE public.t (id int);   \n\tALTER TABLE public.t OWNER TO postgres;\t\t\n';

    expect(sanitizeDump(raw)).toBe(
      'CREATE TABLE public.t (id int);\n\tALTER TABLE public.t OWNER TO postgres;\n',
    );
  });

  it('keeps GRANT, REVOKE, ALTER DEFAULT PRIVILEGES, policies and triggers verbatim', () => {
    const raw = [
      "CREATE POLICY crm_contacts_org_guc ON public.crm_contacts USING (org_id = current_setting('app.current_org_id')::uuid);",
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_contacts TO app_ledger;',
      'REVOKE ALL ON public.crm_contacts FROM PUBLIC;',
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO app_assistant_ro;',
      'CREATE TRIGGER crm_contacts_set_updated_at BEFORE UPDATE ON public.crm_contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();',
    ].join('\n');

    expect(sanitizeDump(raw)).toBe(raw + '\n');
  });

  it('never filters a line inside a dollar-quoted function body, even if it looks like a SET line or a comment', () => {
    const raw = [
      'CREATE FUNCTION public.claim_jobs() RETURNS void',
      '    LANGUAGE plpgsql',
      '    AS $$',
      'BEGIN',
      '  -- this comment lives inside the function body and must survive',
      '  SET search_path = public;',
      "  SELECT pg_catalog.set_config('search_path', 'public', true);",
      'END;',
      '$$;',
    ].join('\n');

    expect(sanitizeDump(raw)).toBe(raw + '\n');
  });

  it('handles a same-line open+close dollar-quoted body correctly', () => {
    const raw = [
      'COMMENT ON FUNCTION public.f() IS $tag$-- not a comment line$tag$;',
      'GRANT USAGE ON SCHEMA public TO app_ledger;',
    ].join('\n');

    expect(sanitizeDump(raw)).toBe(raw + '\n');
  });

  it('preserves all 87 rows of a realistic pg_dump --data-only COPY-format ledger dump', () => {
    // Regression for a 2026-09-16 incident: a restored QA stack ended up
    // with only 84/87 hub_migrations rows. This mimics real pg_dump
    // --data-only --table=public.hub_migrations output (full preamble,
    // "Data for Name" comment header, COPY block, trailing dump-complete
    // footer) end to end through the actual sanitizer, not a minimal
    // fixture, so a bug tied to that surrounding structure can't hide.
    const rows = Array.from({ length: 87 }, (_, i) => {
      const version = String(20260101000000 + i * 10000).padStart(14, '0');
      return `${version}\t2026-01-01 00:00:00.123456+00`;
    });
    const raw = [
      '--',
      '-- PostgreSQL database dump',
      '--',
      '',
      'SET statement_timeout = 0;',
      'SET lock_timeout = 0;',
      'SET idle_in_transaction_session_timeout = 0;',
      "SET client_encoding = 'UTF8';",
      'SET standard_conforming_strings = on;',
      "SELECT pg_catalog.set_config('search_path', '', false);",
      'SET check_function_bodies = false;',
      'SET xmloption = content;',
      'SET client_min_messages = warning;',
      'SET row_security = off;',
      '',
      "SET default_tablespace = '';",
      '',
      'SET default_table_access_method = heap;',
      '',
      '--',
      '-- Data for Name: hub_migrations; Type: TABLE DATA; Schema: public; Owner: postgres',
      '--',
      '',
      'COPY public.hub_migrations (version, applied_at) FROM stdin;',
      ...rows,
      '\\.',
      '',
      '',
      '--',
      '-- PostgreSQL database dump complete',
      '--',
      '',
    ].join('\n');

    const outRows = sanitizeDump(raw)
      .split('\n')
      .filter((line) => /^\d{14}\t/.test(line));

    expect(outRows).toHaveLength(87);
    expect(outRows).toEqual(rows);
  });

  it('is idempotent — sanitizing already-sanitized output changes nothing', () => {
    const raw =
      ['CREATE TABLE public.t (id int);', 'GRANT SELECT ON public.t TO app_ledger;'].join('\n') +
      '\n';

    expect(sanitizeDump(sanitizeDump(raw))).toBe(sanitizeDump(raw));
  });
});
