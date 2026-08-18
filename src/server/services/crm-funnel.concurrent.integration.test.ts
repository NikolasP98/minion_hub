import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { loadEnv } from 'vite';
import { describe, expect, it } from 'vitest';
import { setFunnelStage } from './crm-contacts.service';

const databaseUrl =
  process.env.SUPABASE_DB_URL ?? loadEnv('development', process.cwd(), '').SUPABASE_DB_URL;

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
  },
);
