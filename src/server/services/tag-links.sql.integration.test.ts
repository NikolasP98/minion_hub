import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as pgSchema from '@minion-stack/db/pg';
import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { testDatabaseUrl } from '$server/test-utils/test-db-url';
import { getTagLinks, setTagLinks } from './tag-links.service';

const databaseUrl = testDatabaseUrl();
const admin = databaseUrl ? postgres(databaseUrl, { max: 2, prepare: false }) : null;
const appClientA = databaseUrl ? postgres(databaseUrl, { max: 1, prepare: false }) : null;
const appClientB = databaseUrl ? postgres(databaseUrl, { max: 1, prepare: false }) : null;
const appDbA = appClientA ? drizzle(appClientA, { schema: pgSchema }) : null;
const appDbB = appClientB ? drizzle(appClientB, { schema: pgSchema }) : null;

describe.runIf(Boolean(databaseUrl))('tag link service SQL behavior', () => {
  afterAll(async () => {
    await Promise.all([admin?.end(), appClientA?.end(), appClientB?.end()]);
  });

  it('scopes reads and replaces only manual links, including concurrent replacements', async () => {
    const org = `tag-link-test-${randomUUID()}`;
    const otherOrg = `tag-link-other-${randomUUID()}`;
    const entity = randomUUID();
    const manualOld = randomUUID();
    const manualA = randomUUID();
    const manualB = randomUUID();
    const automatic = randomUUID();
    const wrongScope = randomUUID();
    const foreign = randomUUID();
    const ctxA = { tenantId: org, db: appDbA! };
    const ctxB = { tenantId: org, db: appDbB! };

    try {
      await admin!`insert into crm_tags (id,org_id,name,kind,scope,position) values
        (${manualOld},${org},'Old manual','manual','catalog',0),
        (${manualA},${org},'Manual A','manual','catalog',1),
        (${manualB},${org},'Manual B','manual','catalog',2),
        (${automatic},${org},'Automatic','auto','catalog',3),
        (${wrongScope},${org},'Event only','manual','event',4),
        (${foreign},${otherOrg},'Foreign','manual','catalog',0)`;
      // These two links model historical/system-owned data that the manual
      // editor can display but must never erase.
      await admin!`insert into tag_links (org_id,entity_kind,entity_id,tag_id) values
        (${org},'product',${entity},${manualOld}),
        (${org},'product',${entity},${automatic}),
        (${org},'product',${entity},${wrongScope})`;

      const initial = await getTagLinks(ctxA, 'product', [entity]);
      expect(initial.get(entity)?.map((tag) => tag.id)).toEqual([manualOld, automatic, wrongScope]);
      expect(
        (await getTagLinks({ tenantId: otherOrg, db: appDbA! }, 'product', [entity])).size,
      ).toBe(0);

      await expect(setTagLinks(ctxA, 'product', entity, [foreign], null)).rejects.toThrow(
        /invalid/,
      );
      await expect(setTagLinks(ctxA, 'product', entity, [wrongScope], null)).rejects.toThrow(
        /invalid/,
      );

      await setTagLinks(ctxA, 'product', entity, [manualA], null);
      let rows = await admin!<{ tag_id: string }[]>`
        select tag_id::text from tag_links
        where org_id=${org} and entity_kind='product' and entity_id=${entity}
        order by tag_id`;
      expect(rows.map((row) => row.tag_id).sort()).toEqual([manualA, automatic, wrongScope].sort());

      let replaceA!: Promise<unknown>;
      let replaceB!: Promise<unknown>;
      await admin!.begin(async (blocker) => {
        const lockKey = JSON.stringify(['tag-links', org, 'product', entity]);
        await blocker`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
        replaceA = setTagLinks(ctxA, 'product', entity, [manualA], null);
        replaceB = setTagLinks(ctxB, 'product', entity, [manualB], null);
        // Both independent service connections must reach and wait on the
        // blocker before it commits. This makes the serialization proof a
        // real contention test rather than scheduler-dependent Promise timing.
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const [{ waiting }] = await blocker<{ waiting: number }[]>`
            select count(*)::int as waiting from pg_locks
            where locktype='advisory' and not granted`;
          if (waiting >= 2) return;
          await blocker`select pg_sleep(0.025)`;
        }
        throw new Error('tag replacement calls did not contend on the advisory lock');
      });
      await Promise.all([replaceA, replaceB]);
      rows = await admin!<{ tag_id: string }[]>`
        select tag_id::text from tag_links
        where org_id=${org} and entity_kind='product' and entity_id=${entity}`;
      const ids = rows.map((row) => row.tag_id);
      expect(ids).toContain(automatic);
      expect(ids).toContain(wrongScope);
      expect(ids.filter((id) => id === manualA || id === manualB)).toHaveLength(1);

      await setTagLinks(ctxA, 'product', entity, [], null);
      rows = await admin!<{ tag_id: string }[]>`
        select tag_id::text from tag_links
        where org_id=${org} and entity_kind='product' and entity_id=${entity}`;
      expect(rows.map((row) => row.tag_id).sort()).toEqual([automatic, wrongScope].sort());
    } finally {
      await admin!`delete from tag_links where org_id in (${org},${otherOrg})`;
      await admin!`delete from crm_tags where org_id in (${org},${otherOrg})`;
    }
  });
});
