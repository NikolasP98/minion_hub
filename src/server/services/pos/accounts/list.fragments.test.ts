import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { clientKeySql, LIST_PENDING_LINE_WHERE } from './list';

const render = (fragment: Parameters<PgDialect['sqlToQuery']>[0]) =>
  new PgDialect().sqlToQuery(fragment).sql.replace(/\s+/g, ' ');

describe('exported list SQL fragments (shared with the receivables audit)', () => {
  it('derives the canonical client key: party wins, else non-deleted bridged contact, else contact', () => {
    expect(render(clientKeySql('b'))).toBe(
      "case when b.party_id is not null then 'party:' || b.party_id::text when c.party_id is not null and c.deleted_at is null then 'party:' || c.party_id::text else 'contact:' || b.crm_contact_id::text end",
    );
  });
  it('keeps the list pending predicate: service line, unlinked, non-void ticket, identity required', () => {
    expect(render(LIST_PENDING_LINE_WHERE)).toBe(
      "tl.kind = 'service' and tl.booking_id is null and tl.plan_id is null and t.status <> 'void' and (t.party_id is not null or t.crm_contact_id is not null)",
    );
  });
});
