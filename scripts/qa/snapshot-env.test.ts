import { describe, expect, it } from 'vitest';
import { parseEnvFile, redactUrl, toSessionPoolerUrl } from './snapshot-env';

describe('parseEnvFile', () => {
  it('parses KEY=value lines, ignoring comments and blank lines', () => {
    const text = [
      '# a comment',
      '',
      'SUPABASE_DB_URL=postgresql://postgres:secret@db.example.supabase.co:6543/postgres',
      'OTHER = "quoted value"',
      "THIRD='single quoted'",
    ].join('\n');

    expect(parseEnvFile(text)).toEqual({
      SUPABASE_DB_URL: 'postgresql://postgres:secret@db.example.supabase.co:6543/postgres',
      OTHER: 'quoted value',
      THIRD: 'single quoted',
    });
  });

  it('skips malformed lines with no "="', () => {
    expect(parseEnvFile('not-a-kv-line\nKEY=value')).toEqual({ KEY: 'value' });
  });
});

describe('toSessionPoolerUrl', () => {
  it('rewrites the transaction pooler port 6543 to the session pooler port 5432', () => {
    const result = toSessionPoolerUrl(
      'postgresql://postgres:secret@aws-0-x.pooler.supabase.com:6543/postgres',
    );
    expect(result.rewritten).toBe(true);
    expect(result.url).toBe(
      'postgresql://postgres:secret@aws-0-x.pooler.supabase.com:5432/postgres',
    );
  });

  it('leaves a non-6543 URL untouched', () => {
    const result = toSessionPoolerUrl('postgresql://postgres:secret@db.example.com:5432/postgres');
    expect(result).toEqual({
      url: 'postgresql://postgres:secret@db.example.com:5432/postgres',
      rewritten: false,
    });
  });
});

describe('redactUrl', () => {
  it('masks the password and keeps the rest of the URL', () => {
    expect(redactUrl('postgresql://postgres:supersecret@db.example.com:5432/postgres')).toBe(
      'postgresql://postgres:***@db.example.com:5432/postgres',
    );
  });

  it('falls back to a placeholder for an unparseable url', () => {
    expect(redactUrl('not a url')).toBe('<unparseable connection url>');
  });
});
