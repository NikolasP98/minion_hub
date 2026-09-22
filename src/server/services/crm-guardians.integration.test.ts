import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabaseUrl } from '$server/test-utils/test-db-url';

const databaseUrl = testDatabaseUrl();
const sql = databaseUrl ? postgres(databaseUrl, { max: 2, prepare: false }) : null;

describe.runIf(Boolean(databaseUrl))('crm legal guardian database invariants', () => {
  afterAll(async () => sql?.end());

  it('accepts exact-18 adults idempotently and rejects missing/young/company/cross-org guardians', async () => {
    const org = `guardian-test-${randomUUID()}`;
    const otherOrg = `guardian-other-${randomUUID()}`;
    const wardParty = randomUUID();
    const ward = randomUUID();
    const adultParty = randomUUID();
    const adult = randomUUID();
    const missingParty = randomUUID();
    const missing = randomUUID();
    const youngParty = randomUUID();
    const young = randomUUID();
    const companyParty = randomUUID();
    const company = randomUUID();
    const foreignParty = randomUUID();
    const foreign = randomUUID();

    await sql!
      .begin(async (tx) => {
        await tx`insert into parties (id,org_id,type,name,dob) values
        (${wardParty},${org},'person','Ward',current_date - interval '10 years'),
        (${adultParty},${org},'person','Adult',current_date - interval '18 years'),
        (${missingParty},${org},'person','Missing DOB',null),
        (${youngParty},${org},'person','Young',current_date - interval '18 years' + interval '1 day'),
        (${companyParty},${org},'company','Company',current_date - interval '40 years'),
        (${foreignParty},${otherOrg},'person','Other org',current_date - interval '40 years')`;
        await tx`insert into crm_contacts (id,org_id,party_id,display_name,source) values
        (${ward},${org},${wardParty},'Ward','manual'),
        (${adult},${org},${adultParty},'Adult','manual'),
        (${missing},${org},${missingParty},'Missing','manual'),
        (${young},${org},${youngParty},'Young','manual'),
        (${company},${org},${companyParty},'Company','manual'),
        (${foreign},${otherOrg},${foreignParty},'Foreign','manual')`;

        await tx`insert into crm_contact_guardians (org_id,ward_contact_id,guardian_contact_id)
        values (${org},${ward},${adult}) on conflict do nothing`;
        await tx`insert into crm_contact_guardians (org_id,ward_contact_id,guardian_contact_id)
        values (${org},${ward},${adult}) on conflict do nothing`;
        const [{ count }] = await tx<
          { count: number }[]
        >`select count(*)::int as count from crm_contact_guardians where org_id=${org}`;
        expect(count).toBe(1);

        for (const invalid of [missing, young, company, foreign]) {
          await expect(
            tx.savepoint(
              (
                sp,
              ) => sp`insert into crm_contact_guardians (org_id,ward_contact_id,guardian_contact_id)
            values (${org},${ward},${invalid})`,
            ),
          ).rejects.toThrow(/distinct adult person contact/i);
        }
        await expect(
          tx.savepoint(
            (sp) =>
              sp`update parties set dob=current_date - interval '17 years' where id=${adultParty}`,
          ),
        ).rejects.toThrow(/must remain an adult/i);
        await tx`delete from crm_contact_guardians where org_id=${org} and guardian_contact_id=${adult}`;
        await tx`update parties set dob=current_date - interval '17 years' where id=${adultParty}`;

        throw new Error('ROLLBACK_FIXTURE');
      })
      .catch((error) => {
        if (!(error instanceof Error) || error.message !== 'ROLLBACK_FIXTURE') throw error;
      });
  });
});
