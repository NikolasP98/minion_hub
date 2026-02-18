import type { Db } from '$server/db/client';

export interface TenantContext {
  db: Db;
  tenantId: string;
}
