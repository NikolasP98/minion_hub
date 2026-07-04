import { describe, it, expect } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { ensureAccountInScope } from './crm-contacts.service';

describe('ensureAccountInScope', () => {
  it('is a no-op on the legacy (unconfigured) scope — accounts stays null', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // crm_settings select → no row → getCrmSettings returns { accounts: null }
    const ctx = { db: db as never, tenantId: 'org-1' };

    await ensureAccountInScope(ctx, 'messenger', 'page-1', 'FACES Page');

    expect(db.insert).not.toHaveBeenCalled();
  });

  it('appends the account when the explicit scope does not have it yet', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ value: { accounts: [{ channel: 'whatsapp', accountId: 'wa-1' }] } }], // getCrmSettings select
      [], // persistConfigs insert().onConflictDoUpdate()
    ]);
    const ctx = { db: db as never, tenantId: 'org-1' };

    await ensureAccountInScope(ctx, 'messenger', 'page-1', 'FACES Page');

    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — already-present account does not trigger a write', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ value: { accounts: [{ channel: 'messenger', accountId: 'page-1' }] } }]);
    const ctx = { db: db as never, tenantId: 'org-1' };

    await ensureAccountInScope(ctx, 'messenger', 'page-1', 'FACES Page');

    expect(db.insert).not.toHaveBeenCalled();
  });
});
