import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

const h = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('$server/db/pg-client', () => ({ getCoreDb: () => ({ execute: h.execute }) }));

import { STALE_SEND_MINUTES, reapStaleSends } from './stale-sends.service';

const dialect = new PgDialect();
const rendered = () =>
  h.execute.mock.calls.map((c) => {
    const q = dialect.sqlToQuery(c[0] as SQL);
    return { text: q.sql.replace(/\s+/g, ' ').trim(), params: q.params };
  });

beforeEach(() => {
  h.execute.mockReset();
  h.execute
    .mockResolvedValueOnce([{ id: 'r1' }, { id: 'r2' }])
    .mockResolvedValueOnce([{ id: 'f1' }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: 'e1' }]);
});

describe('reapStaleSends', () => {
  it('fails stale reminders, follow-ups and emissions across every organisation', async () => {
    expect(await reapStaleSends()).toEqual({
      reminders: 2,
      followups: 1,
      emissions: 0,
      reconfirms: 1,
    });
    const [rem, fu, em, rc] = rendered();
    expect(rem.text).toContain(
      "update sched_reminders set status = 'failed', error = 'stale_claim' where status = 'sending' and created_at < now() - make_interval(mins => $1)",
    );
    expect(fu.text).toContain(
      "update crm_door_followups set status = 'failed', error = 'stale_claim' where status = 'sending' and created_at < now() - make_interval(mins => $1)",
    );
    expect(em.text).toContain(
      "update pos_emissions set status = 'error', response_description = 'stale_pending', updated_at = now() where status = 'pending' and updated_at < now() - make_interval(mins => $1)",
    );
    expect(rc.text).toContain(
      "update sched_reconfirm_cases c set result = 'send_failed', agent_state = 'done'",
    );
    expect(rc.text).toContain("c.agent_state = 'none'");
    expect(rc.text).not.toContain('delete');
    for (const q of [rem, fu, em, rc]) expect(q.params).toEqual([STALE_SEND_MINUTES]);
    for (const q of [rem, fu, em]) expect(q.text).not.toContain('org_id'); // cross-organisation on purpose
    expect(rc.text).not.toContain('where org_id'); // no org filter: the sweep spans organisations
    expect(STALE_SEND_MINUTES).toBe(15);
  });
});
