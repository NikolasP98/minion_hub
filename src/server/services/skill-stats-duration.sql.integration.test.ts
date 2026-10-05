import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { skillExecutionStats } from '@minion-stack/db/pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDisposablePostgres } from '../../../scripts/qc/disposable-postgres';
import { skillStatsSummarySelection } from './skill-stats.service';

let harness: Awaited<ReturnType<typeof openDisposablePostgres>>;
let owner: ReturnType<Awaited<ReturnType<typeof openDisposablePostgres>>['createConnection']>;
const schema = `qc_job_stock_${randomUUID().replaceAll('-', '')}`;
const ORG = '71000000-0000-4000-8000-000000000001';
const GATEWAY = '72000000-0000-4000-8000-000000000001';

beforeAll(async () => {
  harness = await openDisposablePostgres();
  await harness.owner.unsafe(`CREATE SCHEMA "${schema}"`);
  owner = harness.createConnection(schema);
  await owner.unsafe(`
    CREATE TABLE skill_execution_stats (
      id bigserial PRIMARY KEY,
      tenant_id uuid NOT NULL,
      gateway_id uuid NOT NULL,
      agent_id text,
      skill_name text NOT NULL,
      session_key text,
      status text NOT NULL,
      duration_ms integer,
      error_message text,
      occurred_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await owner`
    INSERT INTO skill_execution_stats
      (tenant_id,gateway_id,skill_name,status,duration_ms,occurred_at)
    SELECT ${ORG}::uuid,${GATEWAY}::uuid,'calendar','ok',NULL,now()
    FROM generate_series(1,8)
  `;
  await owner`
    INSERT INTO skill_execution_stats
      (tenant_id,gateway_id,skill_name,status,duration_ms,occurred_at)
    VALUES
      (${ORG}::uuid,${GATEWAY}::uuid,'calendar','ok',0,now()),
      (${ORG}::uuid,${GATEWAY}::uuid,'calendar','ok',20,now())
  `;
  await owner`
    INSERT INTO skill_execution_stats
      (tenant_id,gateway_id,skill_name,status,duration_ms,occurred_at)
    SELECT ${ORG}::uuid,${GATEWAY}::uuid,'calendar','error',NULL,now()
    FROM generate_series(1,99)
  `;
  await owner`
    INSERT INTO skill_execution_stats
      (tenant_id,gateway_id,skill_name,status,duration_ms,occurred_at)
    VALUES
      (${ORG}::uuid,${GATEWAY}::uuid,'calendar','error',40,now()),
      (${ORG}::uuid,${GATEWAY}::uuid,'measured-zero','ok',0,now()),
      (${ORG}::uuid,${GATEWAY}::uuid,'missing-only','timeout',NULL,now()),
      (${ORG}::uuid,${GATEWAY}::uuid,'missing-only','timeout',NULL,now())
  `;
}, 20_000);

afterAll(async () => {
  if (!harness) return;
  await harness.owner.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await harness.close();
});

describe('native skill duration denominator', () => {
  it('counts only measured durations while preserving total executions, real zero and mixed statuses', async () => {
    const db = drizzle(owner);
    const rows = await db
      .select(skillStatsSummarySelection)
      .from(skillExecutionStats)
      .groupBy(skillExecutionStats.skillName, skillExecutionStats.status)
      .orderBy(skillExecutionStats.skillName, skillExecutionStats.status);

    expect(rows).toEqual([
      {
        skillName: 'calendar',
        status: 'error',
        count: 100,
        durationCount: 1,
        avgDurationMs: 40,
        minDurationMs: 40,
        maxDurationMs: 40,
      },
      {
        skillName: 'calendar',
        status: 'ok',
        count: 10,
        durationCount: 2,
        avgDurationMs: 10,
        minDurationMs: 0,
        maxDurationMs: 20,
      },
      {
        skillName: 'measured-zero',
        status: 'ok',
        count: 1,
        durationCount: 1,
        avgDurationMs: 0,
        minDurationMs: 0,
        maxDurationMs: 0,
      },
      {
        skillName: 'missing-only',
        status: 'timeout',
        count: 2,
        durationCount: 0,
        avgDurationMs: null,
        minDurationMs: null,
        maxDurationMs: null,
      },
    ]);
  });
});
