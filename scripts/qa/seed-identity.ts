/** Apply ONLY the identity-required POS fixtures to the existing local QA stack. */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { parseEnvFile } from './snapshot-env';
import { assertLoopback, type RowRef } from './seed/db';
import { IDENTITY_FIXTURES, seed } from './seed/pos-identity';

const qa = parseEnvFile(readFileSync(new URL('../../.env.qa', import.meta.url), 'utf8'));
const sql = postgres(assertLoopback(qa.SUPABASE_DB_URL, '.env.qa SUPABASE_DB_URL'), {
  max: 1,
  prepare: false,
});
try {
  const registered = new Map<string, RowRef>();
  await seed({
    sql,
    register: (id, row) => {
      registered.set(id, row);
    },
  });
  console.log(JSON.stringify({ fixtures: IDENTITY_FIXTURES, registered: registered.size }));
} finally {
  await sql.end({ timeout: 5 });
}
