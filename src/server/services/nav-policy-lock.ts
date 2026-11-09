import { sql } from 'drizzle-orm';
import type { CoreTx } from '$server/db/with-org-core';
/** Serialize policy/whole-nav writes, including first rows and deleted targets. */
export async function lockNavigationPolicy(tx: CoreTx, orgId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${orgId},112))`);
}
