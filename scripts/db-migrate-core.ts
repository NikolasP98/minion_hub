import type postgres from 'postgres';

/** The existing Hub migration namespace. Kept identical for production and previews. */
export const HUB_MIGRATION_LOCK_KEY = 826744;

function ledgerIdentifier(schema: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Invalid migration ledger schema');
  return `"${schema}"."hub_migrations"`;
}
/** Apply and record one migration atomically under the existing transaction advisory lock.
 * The CLI always uses public. Tests can supply only their already-guarded owned schema. */
export async function applyHubMigration(
  connection: ReturnType<typeof postgres>,
  input: { version: string; body: string; ledgerSchema?: string },
): Promise<boolean> {
  const ledger = ledgerIdentifier(input.ledgerSchema ?? 'public');
  return connection.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${HUB_MIGRATION_LOCK_KEY})`;
    const duplicate = await tx.unsafe(`select 1 from ${ledger} where version=$1`, [input.version]);
    if (duplicate.length > 0) return false;
    await tx.unsafe(input.body);
    await tx.unsafe(`insert into ${ledger}(version) values ($1)`, [input.version]);
    return true;
  });
}
