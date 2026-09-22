// One-time deployment provisioner. Run as root with the existing Hub environment.
// Fails on existing objects; never rotates credentials or replaces another deployment.
import fs from 'node:fs';
import crypto from 'node:crypto';
import postgres from 'postgres';
const sql = postgres(process.env.SUPABASE_DB_URL, { max: 1, prepare: false, connect_timeout: 5 });
try {
  if (fs.existsSync('/etc/minion/jev-shadow.env')) throw Error('shadow_env_exists');
  const source = fs.readFileSync(new URL('./source.sql', import.meta.url), 'utf8');
  const password = crypto.randomBytes(32).toString('hex');
  const url = new URL(process.env.SUPABASE_DB_URL);
  const original = decodeURIComponent(url.username);
  url.username =
    'minion_jev_shadow' +
    (original.includes('.') ? '.' + original.split('.').slice(1).join('.') : '');
  url.password = password;
  await sql.begin(async (tx) => {
    await tx`set local statement_timeout='10s'`;
    const orgs = await tx`select id from public.organizations where slug='faces-sculptors'`;
    if (orgs.length !== 1) throw Error('org_not_unique');
    await tx.unsafe(
      `CREATE ROLE minion_jev_shadow LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION CONNECTION LIMIT 2`,
    );
    await tx.unsafe('ALTER ROLE minion_jev_shadow SET default_transaction_read_only=on');
    await tx.unsafe('ALTER ROLE minion_jev_shadow SET statement_timeout=5000');
    await tx.unsafe(source);
  });
  const contents = `JEV_SHADOW_DATABASE_URL=${url.toString()}\nOPENROUTER_API_KEY=${process.env.OPENROUTER_API_KEY ?? ''}\n`;
  if (/[\r\n]/.test(process.env.OPENROUTER_API_KEY ?? '')) throw Error('invalid_key');
  fs.writeFileSync('/etc/minion/jev-shadow.env', contents, { mode: 0o600, flag: 'wx' });
  console.log(
    JSON.stringify({
      provisioned: true,
      scope: 'faces-sculptors',
      source: 'read-only-functions',
      customer_tables_modified: false,
    }),
  );
} catch (e) {
  console.error(JSON.stringify({ provisioned: false, code: e.code ?? e.message }));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 2 });
}
