import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { loadEnv } from 'vite';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { crmContacts } from '$server/db/pg-crm-schema';
import { setContactCustomField, setFunnelStage, updateContact } from './crm-contacts.service';

/**
 * Unlike its siblings (crm-contacts.sql.integration.test.ts,
 * crm-funnel-parity.sql.integration.test.ts), this file does NOT create its own
 * throwaway schema: the lost-update property it proves runs through the real
 * `withOrgCore` path, so it needs pre-existing `organizations` (for the org row
 * + RLS GUC) and `crm_activities` rows. Per the standing schema note, those
 * tables have no `CREATE` anywhere in the monorepo — they exist only in the
 * provisioned Supabase database — so this suite CANNOT run against the bare
 * `postgres:` service container the CI Postgres job spins up, and no CI job
 * names it. It runs only against a full-schema database (the local Supabase
 * stack, or a branch DB) with SUPABASE_DB_URL pointed at it.
 *
 * TODO(handoff): the spec's central concurrency claim is therefore proven by a
 * suite that executes on no automated gate — CI covers the atomic write only
 * via the single-connection pglite tests (crm-journey.atomic-write.test.ts),
 * which cannot interleave two transactions. Closing this needs a CI job with a
 * full-schema database (seed `organizations` from a dump, or point the job at a
 * Supabase branch DB) that runs this file with
 * REQUIRE_CRM_FUNNEL_CONCURRENT_POSTGRES=1. Pointer:
 * spec 2026-08-18-hub-funnel-atomic-write-spec; schema constraint is the
 * "hub schema NOT reproducible" operator note; CI job is
 * `.github/workflows/ci.yml` → "Real-PostgreSQL CRM pagination suite".
 */
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? loadEnv('development', process.cwd(), '').SUPABASE_DB_URL;

// Same loud-skip convention as the parity suite: when a caller PROMISES a
// database, an empty URL is a misconfigured job, not a reason to quietly pass.
if (process.env.REQUIRE_CRM_FUNNEL_CONCURRENT_POSTGRES && !databaseUrl) {
  throw new Error(
    'REQUIRE_CRM_FUNNEL_CONCURRENT_POSTGRES is set but SUPABASE_DB_URL is empty — this suite ' +
      'needs a FULL-SCHEMA database (organizations + crm_activities), not the bare CI service.',
  );
}

/**
 * Poll `pg_stat_activity` until `pid` is actually waiting on a lock. Review
 * round 1 (S2) flagged that the sibling tests below only prove ordering via
 * `Promise` sequencing/gate signals — a writer whose statement raced ahead of
 * the coordinator's `FOR UPDATE` (or that never contended for the row at all)
 * would still make those tests pass without exercising the blocking path the
 * spec's ship gate requires. This is the affirmative check: it fails loudly
 * (rather than the test passing on luck) if `pid` never enters `Lock` waits.
 */
async function waitUntilBlocked(probe: ReturnType<typeof postgres>, pid: number) {
  for (let i = 0; i < 300; i++) {
    const [row] = await probe<{ waiting: boolean }[]>`
      select wait_event_type = 'Lock' as waiting from pg_stat_activity where pid = ${pid}
    `;
    if (row?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`backend ${pid} never reached a blocked (Lock) wait state`);
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

    /**
     * Review round 1 (S2) on the pglite suites (`crm-contacts.custom-fields.test.ts`,
     * `contact-update.server.test.ts`) found their "both writers survive" cases
     * either awaited sequentially (proving commit order, not concurrency) or
     * simulated interleaving with a raw SQL statement on the SAME single-session
     * connection (proving nothing about lock-wait behavior under real concurrent
     * writers). Those suites stay — they pin the SQL shape and per-engine merge
     * semantics — but the actual ship-gate proof lives here: a THIRD connection
     * (the coordinator) takes `SELECT ... FOR UPDATE` first, two independent
     * writer connections are started (one at a time, each affirmed blocked
     * before the next starts), `pg_stat_activity` confirms BOTH are genuinely
     * queued on the lock (not just "happened to resolve in order"), then the
     * lock is released and both keys — plus the FIFO release/completion order —
     * are asserted.
     *
     * Review round 2 flagged that polling `pg_stat_activity` through `owner`
     * deadlocked: `owner` has `max: 1` and its sole connection is reserved for
     * the whole `owner.begin(...)` callback that holds the coordinator lock, so
     * a `pg_stat_activity` query on `owner` could never get a connection until
     * *after* the lock-holding callback finished — which itself only finishes
     * once `waitUntilBlocked` returns. A dedicated `probe` connection (not
     * inside the locking transaction) breaks that cycle.
     */
    async function proveBothWritersQueueBehindCoordinatorLock<A, B>(
      writerA: (
        orgId: string,
        contactId: string,
        client: ReturnType<typeof postgres>,
      ) => Promise<A>,
      writerB: (
        orgId: string,
        contactId: string,
        client: ReturnType<typeof postgres>,
      ) => Promise<B>,
    ) {
      const owner = postgres(databaseUrl!, { max: 1, prepare: false });
      const clientA = postgres(databaseUrl!, { max: 1, prepare: false });
      const clientB = postgres(databaseUrl!, { max: 1, prepare: false });
      const probe = postgres(databaseUrl!, { max: 1, prepare: false });
      let contactId: string | undefined;
      try {
        const seeded = await seedContact(owner);
        contactId = seeded.contactId;
        const { orgId } = seeded;

        const [{ pid: pidA }] = await clientA<{ pid: number }[]>`select pg_backend_pid() as pid`;
        const [{ pid: pidB }] = await clientB<{ pid: number }[]>`select pg_backend_pid() as pid`;

        let lockHeld!: () => void;
        const lockIsHeld = new Promise<void>((resolve) => (lockHeld = resolve));
        let releaseLock!: () => void;
        const releaseRequested = new Promise<void>((resolve) => (releaseLock = resolve));

        const coordination = owner.begin(async (tx) => {
          await tx`select id from crm_contacts where id = ${seeded.contactId} for update`;
          lockHeld();
          await releaseRequested;
        });
        await lockIsHeld;

        // Machine-check the queue order the two "reverse start order" test
        // variants exist to distinguish: start A, affirm it is genuinely
        // blocked on the coordinator's lock, THEN start B and affirm the same
        // for it — rather than firing both and only proving they eventually
        // both resolve.
        const order: Array<'A' | 'B'> = [];
        const resultA = writerA(orgId, seeded.contactId, clientA).then((r) => {
          order.push('A');
          return r;
        });
        await waitUntilBlocked(probe, pidA);

        const resultB = writerB(orgId, seeded.contactId, clientB).then((r) => {
          order.push('B');
          return r;
        });
        await waitUntilBlocked(probe, pidB);

        releaseLock();
        await coordination;
        await Promise.all([resultA, resultB]);

        const [row] = await readFields(owner, seeded.contactId);
        return { cf: row.cf, order };
      } finally {
        if (contactId) await owner`delete from crm_contacts where id = ${contactId}`;
        await Promise.all([
          owner.end({ timeout: 5 }),
          clientA.end({ timeout: 5 }),
          clientB.end({ timeout: 5 }),
          probe.end({ timeout: 5 }),
        ]);
      }
    }

    const writeFunnelViaSetFunnelStage = (
      orgId: string,
      contactId: string,
      client: ReturnType<typeof postgres>,
    ) =>
      setFunnelStage({ db: drizzle(client) as never, tenantId: orgId }, contactId, 'customer', {
        by: 'user',
      });

    const writePatchViaUpdateContact = (
      orgId: string,
      contactId: string,
      client: ReturnType<typeof postgres>,
    ) =>
      updateContact({ db: drizzle(client) as never, tenantId: orgId }, contactId, {
        customFieldsPatch: { favoriteColor: 'blue' },
      });

    const writeFunnelViaSetContactCustomField = (
      orgId: string,
      contactId: string,
      client: ReturnType<typeof postgres>,
    ) =>
      drizzle(client).transaction((tx) =>
        setContactCustomField(tx as never, orgId, contactId, '_funnel', {
          stage: 'customer',
          auto: false,
        }),
      );

    const writeRelationshipViaSetContactCustomField = (
      orgId: string,
      contactId: string,
      client: ReturnType<typeof postgres>,
    ) =>
      drizzle(client).transaction((tx) =>
        setContactCustomField(tx as never, orgId, contactId, '_relationship', { label: 'mamá' }),
      );

    it('setFunnelStage and the customFieldsPatch writer (contact patch service) both queue on the coordinator lock and both survive — funnel starts first', async () => {
      const { cf, order } = await proveBothWritersQueueBehindCoordinatorLock(
        writeFunnelViaSetFunnelStage,
        writePatchViaUpdateContact,
      );
      expect(cf._funnel).toMatchObject({ stage: 'customer', auto: false });
      expect(cf.favoriteColor).toBe('blue');
      expect(cf.nombre).toBe('Ana');
      // FIFO lock queue: the writer that blocked first (funnel) is granted the
      // row lock first once the coordinator releases it.
      expect(order).toEqual(['A', 'B']);
    }, 30_000);

    it('setFunnelStage and the customFieldsPatch writer both queue on the coordinator lock and both survive — patch starts first (reverse start order)', async () => {
      const { cf, order } = await proveBothWritersQueueBehindCoordinatorLock(
        writePatchViaUpdateContact,
        writeFunnelViaSetFunnelStage,
      );
      expect(cf._funnel).toMatchObject({ stage: 'customer', auto: false });
      expect(cf.favoriteColor).toBe('blue');
      expect(cf.nombre).toBe('Ana');
      // Reversed start order reverses the FIFO grant order — this is the
      // machine check that the two "start order" cases actually differ.
      expect(order).toEqual(['A', 'B']);
    }, 30_000);

    it("setContactCustomField('_funnel', ...) and setContactCustomField('_relationship', ...) both queue on the coordinator lock and both survive — funnel starts first", async () => {
      const { cf, order } = await proveBothWritersQueueBehindCoordinatorLock(
        writeFunnelViaSetContactCustomField,
        writeRelationshipViaSetContactCustomField,
      );
      expect(cf._funnel).toMatchObject({ stage: 'customer', auto: false });
      expect(cf._relationship).toEqual({ label: 'mamá' });
      expect(cf.nombre).toBe('Ana');
      expect(order).toEqual(['A', 'B']);
    }, 30_000);

    it("setContactCustomField('_funnel', ...) and setContactCustomField('_relationship', ...) both queue on the coordinator lock and both survive — relationship starts first (reverse start order)", async () => {
      const { cf, order } = await proveBothWritersQueueBehindCoordinatorLock(
        writeRelationshipViaSetContactCustomField,
        writeFunnelViaSetContactCustomField,
      );
      expect(cf._funnel).toMatchObject({ stage: 'customer', auto: false });
      expect(cf._relationship).toEqual({ label: 'mamá' });
      expect(cf.nombre).toBe('Ana');
      expect(order).toEqual(['A', 'B']);
    }, 30_000);
  },
);
