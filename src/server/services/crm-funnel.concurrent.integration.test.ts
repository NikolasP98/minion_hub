import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { loadEnv } from 'vite';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { crmContacts } from '$server/db/pg-crm-schema';
import { setContactCustomField, setFunnelStage } from './crm-contacts.service';

/**
 * Unlike its siblings (crm-contacts.sql.integration.test.ts,
 * crm-funnel-parity.sql.integration.test.ts), this file does NOT create its own
 * throwaway schema: the lost-update property it proves runs through the real
 * `withOrgCore` path, so it needs pre-existing `organizations` (for the org row
 * + RLS GUC) and `crm_activities` rows, with RLS actually in force on the CRM
 * tables — proving the fix under the real RLS/role machinery is the point, so
 * nothing here mocks or bypasses `withOrgCore`.
 *
 * Per the standing schema note those tables have no `CREATE` anywhere in the
 * monorepo (they exist only in the provisioned Supabase database), so CI
 * supplies them from a CI-ONLY fixture rather than from a migration:
 * `supabase/ci-fixtures/crm-funnel-concurrent.sql` reproduces the prod
 * `crm_contacts` / `crm_activities` / `organizations.id` shape and the
 * `*_org_guc` RLS policies as live-extracted from prod's catalog, and the
 * `crm-funnel-concurrent-postgres` job in `.github/workflows/ci.yml` applies it
 * to a bare `postgres:15` service container, runs a cross-org negative control,
 * then runs THIS file with REQUIRE_CRM_FUNNEL_CONCURRENT_POSTGRES=1 and asserts
 * from a vitest JSON report that all three cases passed and none skipped.
 *
 * Locally it still skips unless SUPABASE_DB_URL is set — point it at the local
 * Supabase stack, a branch DB, or a container seeded with that same fixture.
 */
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? loadEnv('development', process.cwd(), '').SUPABASE_DB_URL;

// Same loud-skip convention as the parity suite: when a caller PROMISES a
// database, an empty URL is a misconfigured job, not a reason to quietly pass.
if (process.env.REQUIRE_CRM_FUNNEL_CONCURRENT_POSTGRES && !databaseUrl) {
  throw new Error(
    'REQUIRE_CRM_FUNNEL_CONCURRENT_POSTGRES is set but SUPABASE_DB_URL is empty — this suite ' +
      'needs a database carrying organizations + crm_activities under the org-GUC RLS policies. ' +
      'The crm-funnel-concurrent-postgres CI job seeds exactly that into its postgres service ' +
      'from supabase/ci-fixtures/crm-funnel-concurrent.sql; locally, point SUPABASE_DB_URL at ' +
      'the Supabase stack or at a container seeded with that same fixture.',
  );
}

describe.runIf(Boolean(databaseUrl))(
  'funnel writes against concurrent PostgreSQL transactions',
  () => {
    it('an automatic writer waiting on the row lock observes a concurrent manual pin', async () => {
      const owner = postgres(databaseUrl!, { max: 1, prepare: false });
      const appClient = postgres(databaseUrl!, { max: 1, prepare: false });
      const contactId = crypto.randomUUID();
      let orgId: string | undefined;

      try {
        const [org] = await owner<{ id: string }[]>`select id::text from organizations limit 1`;
        orgId = org?.id;
        if (!orgId) throw new Error('concurrency test requires an organization row');

        await owner`
        insert into crm_contacts (id, org_id, source, custom_fields)
        values (
          ${contactId},
          ${orgId},
          'manual',
          ${JSON.stringify({ _funnel: { stage: 'lead', auto: true } })}::jsonb
        )
      `;

        let releasePin!: () => void;
        const pinReady = new Promise<void>((resolve) => (releasePin = resolve));
        let allowCommit!: () => void;
        const commitAllowed = new Promise<void>((resolve) => (allowCommit = resolve));

        const pin = owner.begin(async (tx) => {
          await tx`select id from crm_contacts where id = ${contactId} for update`;
          await tx`
          update crm_contacts
          set custom_fields = jsonb_set(
            custom_fields,
            array['_funnel'],
            ${JSON.stringify({ stage: 'customer', auto: false })}::jsonb,
            true
          )
          where id = ${contactId}
        `;
          releasePin();
          await commitAllowed;
        });

        await pinReady;
        const automatic = setFunnelStage(
          { db: drizzle(appClient) as never, tenantId: orgId },
          contactId,
          'loyal',
          { by: 'auto' },
        );

        // The automatic call has started while the pin transaction owns the row.
        // Committing now releases it; SELECT FOR UPDATE must then read the pin.
        allowCommit();
        await pin;
        await expect(automatic).resolves.toEqual({ applied: false, stage: 'customer' });

        const [row] = await owner<{ stage: string; auto: boolean; activities: number }[]>`
        select
          custom_fields->'_funnel'->>'stage' as stage,
          (custom_fields->'_funnel'->>'auto')::boolean as auto,
          (select count(*)::int from crm_activities where contact_id = ${contactId}) as activities
        from crm_contacts
        where id = ${contactId}
      `;
        expect(row).toEqual({ stage: 'customer', auto: false, activities: 0 });
      } finally {
        if (orgId) await owner`delete from crm_contacts where id = ${contactId}`;
        await Promise.all([owner.end({ timeout: 5 }), appClient.end({ timeout: 5 })]);
      }
    }, 30_000);

    /**
     * `_journey` vs `_funnel` (spec 2026-08-18-hub-funnel-atomic-write-spec, S2).
     * Both keys live in the same `custom_fields` column and are written by
     * unrelated flows (`analyzeJourney` / `setFunnelStage`), so the only thing
     * keeping them from clobbering each other is that BOTH now write through
     * `setContactCustomField`'s single per-key `jsonb_set` instead of reading
     * the column into JS and writing the whole object back. That is a property
     * of two genuinely concurrent transactions, so it is proven here against a
     * real PostgreSQL server — the in-process pglite engine used by
     * crm-journey.atomic-write.test.ts is single-connection and cannot
     * interleave two transactions.
     */
    const MILESTONES = [
      {
        id: 'ai:2026-05-01:0:Asked about Botox',
        type: 'ai',
        label: 'Asked about Botox',
        at: '2026-05-01T00:00:00Z',
        detail: 'price inquiry',
      },
    ];

    async function seedContact(owner: ReturnType<typeof postgres>) {
      const [org] = await owner<{ id: string }[]>`select id::text from organizations limit 1`;
      const orgId = org?.id;
      if (!orgId) throw new Error('concurrency test requires an organization row');
      const contactId = crypto.randomUUID();
      await owner`
        insert into crm_contacts (id, org_id, source, custom_fields)
        values (
          ${contactId},
          ${orgId},
          'manual',
          ${JSON.stringify({ _funnel: { stage: 'lead', auto: true }, nombre: 'Ana' })}::jsonb
        )
      `;
      return { orgId, contactId };
    }

    function readFields(owner: ReturnType<typeof postgres>, contactId: string) {
      return owner<{ cf: Record<string, unknown> }[]>`
        select custom_fields as cf from crm_contacts where id = ${contactId}
      `;
    }

    it('a _funnel write queued behind an open _journey transaction keeps BOTH keys', async () => {
      const owner = postgres(databaseUrl!, { max: 1, prepare: false });
      const journeyClient = postgres(databaseUrl!, { max: 1, prepare: false });
      const funnelClient = postgres(databaseUrl!, { max: 1, prepare: false });
      let contactId: string | undefined;

      try {
        const seeded = await seedContact(owner);
        contactId = seeded.contactId;
        const { orgId } = seeded;

        let journeyWrote!: () => void;
        const journeyWriteIssued = new Promise<void>((resolve) => (journeyWrote = resolve));
        let allowJourneyCommit!: () => void;
        const journeyCommitAllowed = new Promise<void>((resolve) => (allowJourneyCommit = resolve));

        // The journey write lands first and holds its row lock open.
        const journeyTxn = drizzle(journeyClient).transaction(async (tx) => {
          await setContactCustomField(tx as never, orgId, seeded.contactId, '_journey', MILESTONES);
          journeyWrote();
          await journeyCommitAllowed;
        });
        await journeyWriteIssued;

        // The funnel writer's SELECT … FOR UPDATE now queues behind that lock;
        // it only proceeds once the journey transaction commits, and must then
        // merge into the row it finds — not over it.
        const funnel = setFunnelStage(
          { db: drizzle(funnelClient) as never, tenantId: orgId },
          seeded.contactId,
          'customer',
          { by: 'user' },
        );
        allowJourneyCommit();
        await journeyTxn;
        await expect(funnel).resolves.toEqual({ applied: true, stage: 'customer' });

        const [row] = await readFields(owner, seeded.contactId);
        expect(row.cf._funnel).toMatchObject({ stage: 'customer', auto: false });
        expect(row.cf._journey).toEqual(MILESTONES);
        expect(row.cf.nombre).toBe('Ana');
      } finally {
        if (contactId) await owner`delete from crm_contacts where id = ${contactId}`;
        await Promise.all([
          owner.end({ timeout: 5 }),
          journeyClient.end({ timeout: 5 }),
          funnelClient.end({ timeout: 5 }),
        ]);
      }
    }, 30_000);

    it('a _funnel write that commits INSIDE the _journey transaction is not reverted by it', async () => {
      const owner = postgres(databaseUrl!, { max: 1, prepare: false });
      const journeyClient = postgres(databaseUrl!, { max: 1, prepare: false });
      const funnelClient = postgres(databaseUrl!, { max: 1, prepare: false });
      let contactId: string | undefined;

      try {
        const seeded = await seedContact(owner);
        contactId = seeded.contactId;
        const { orgId } = seeded;

        let journeyOpened!: () => void;
        const journeyIsOpen = new Promise<void>((resolve) => (journeyOpened = resolve));
        let funnelCommitted!: () => void;
        const funnelIsCommitted = new Promise<void>((resolve) => (funnelCommitted = resolve));
        // What the replaced whole-column shape would have carried into its write.
        let snapshot: Record<string, unknown> | undefined;

        const journeyTxn = drizzle(journeyClient).transaction(async (tx) => {
          // No FOR UPDATE: the competing funnel writer is free to commit here,
          // which is exactly the window the old read → spread → whole-column
          // write straddled.
          const [before] = await tx
            .select({ cf: crmContacts.customFields })
            .from(crmContacts)
            .where(and(eq(crmContacts.id, seeded.contactId), eq(crmContacts.orgId, orgId)))
            .limit(1);
          snapshot = before?.cf as Record<string, unknown>;
          journeyOpened();
          await funnelIsCommitted;
          await setContactCustomField(tx as never, orgId, seeded.contactId, '_journey', MILESTONES);
        });

        await journeyIsOpen;
        await expect(
          setFunnelStage(
            { db: drizzle(funnelClient) as never, tenantId: orgId },
            seeded.contactId,
            'customer',
            { by: 'user' },
          ),
        ).resolves.toEqual({ applied: true, stage: 'customer' });
        funnelCommitted();
        await journeyTxn;

        // The journey transaction observed the PRE-funnel value...
        expect(snapshot?._funnel).toMatchObject({ stage: 'lead', auto: true });
        // ...and still did not write it back over the committed one.
        const [row] = await readFields(owner, seeded.contactId);
        expect(row.cf._funnel).toMatchObject({ stage: 'customer', auto: false });
        expect(row.cf._journey).toEqual(MILESTONES);
        expect(row.cf.nombre).toBe('Ana');
      } finally {
        if (contactId) await owner`delete from crm_contacts where id = ${contactId}`;
        await Promise.all([
          owner.end({ timeout: 5 }),
          journeyClient.end({ timeout: 5 }),
          funnelClient.end({ timeout: 5 }),
        ]);
      }
    }, 30_000);
  },
);
