import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { messages } from '@minion-stack/db/pg';
import { getPgClient } from './pg-pool';

type LedgerDb = ReturnType<typeof drizzle<{ messages: typeof messages }>>;

/** The transaction handle handed to `withOrg` callbacks. */
export type LedgerTx = Parameters<Parameters<LedgerDb['transaction']>[0]>[0];

let _db: LedgerDb | null = null;

function getLedgerDb(): LedgerDb {
  if (_db) return _db;
  _db = drizzle(getPgClient(), { schema: { messages } });
  return _db;
}

/**
 * Run `fn` in a transaction scoped to one org. Inside the transaction we
 * `SET LOCAL ROLE app_ledger` (a non-bypass role) and set the
 * `app.current_org_id` GUC, so the messages RLS policy enforces isolation.
 * Both reset automatically at commit — nothing leaks across pooled connections.
 *
 * This is the ONLY supported way to touch the messages table. Never use
 * getCoreDb() for the ledger (it runs as a bypass role).
 */
export function withOrg<T>(orgId: string, fn: (tx: LedgerTx) => Promise<T>): Promise<T> {
  if (!orgId) throw new Error('withOrg requires a non-empty orgId');
  return getLedgerDb().transaction(async (tx) => {
    await tx.execute(sql`set local role app_ledger`);
    await tx.execute(sql`select set_config('app.current_org_id', ${orgId}, true)`);
    return fn(tx);
  });
}
