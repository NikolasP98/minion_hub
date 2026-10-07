/**
 * HC-019D — record authorization for `scheduling.bookings` custom values,
 * proven against a real `sched_bookings` table (PGlite) with the REAL
 * `authorizeCustomPropertyRecords` and the REAL `POST /api/tables/properties/
 * values/query` handler; only capabilities, module state and the definition/
 * value readers are stubbed. A persona without scheduling (or POS) read gets
 * no record back — so the bundle carries no value and no edit right — and a
 * view-only persona gets the record with `canEdit: false`. Foreign-org rows are
 * never returned to anyone.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { schedBookings } from '$server/db/pg-scheduling-schema';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { CustomPropertyDefinition } from '$lib/tables/custom-properties';

const mocks = vi.hoisted(() => ({
  grants: new Set<string>(),
  moduleEnabled: vi.fn(),
  readValues: vi.fn(),
}));
vi.mock('$server/db/with-org-core', () => ({
  // Real PostgreSQL statement over the fixture table; role/RLS has its own native lane.
  withOrgCore: (ctx: CoreCtx, fn: Parameters<CoreCtx['db']['transaction']>[0]) =>
    ctx.db.transaction(fn),
}));
vi.mock('$server/services/modules.service', () => ({ isModuleEnabled: mocks.moduleEnabled }));
vi.mock('$server/services/rbac.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$server/services/rbac.service')>();
  return {
    ...actual,
    hasOrgCapability: async (_locals: unknown, module: string, action: string) =>
      mocks.grants.has(`${module}:${action}`),
    shouldMaskSensitive: async () => false,
    ownerFilter: async () => undefined,
  };
});
vi.mock('$server/services/user.service', () => ({ listUsers: async () => [] }));
// The query route's other collaborators: table-level access, definitions and
// stored values. Record-level access (the subject) stays real.
vi.mock('$server/services/custom-properties-access', () => ({
  inspectCustomPropertyAccess: async () => ({
    canManage: false,
    canEdit: mocks.grants.has('scheduling:edit') || mocks.grants.has('pos:edit'),
  }),
}));
vi.mock('$server/services/custom-properties.service', () => ({
  CustomPropertyError: class CustomPropertyError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
    ) {
      super(code);
    }
  },
  listCustomProperties: async () => [DEF],
  readCustomPropertyValues: mocks.readValues,
}));
vi.mock('$server/services/formula-properties.service', () => ({
  loadFormulaCatalog: async (
    _locals: unknown,
    _ctx: unknown,
    _tableId: unknown,
    definitions: CustomPropertyDefinition[],
  ) => ({
    definitions,
    fields: [],
    restrictedDefinitionIds: new Set(),
    unavailableDefinitionIds: new Set(),
    currency: null,
  }),
  loadFormulaInputs: async () => ({}),
  formulaInputsFromCustomValues: () => ({}),
  evaluateFormulaDefinitions: async () => ({ cells: {} }),
}));
vi.mock('$server/auth/core-ctx', () => ({ requireCoreCtx: async () => ctx }));

import { authorizeCustomPropertyRecords } from './custom-property-entities.service';
import { POST as queryValues } from '../../routes/api/tables/properties/values/query/+server';

const client = new PGlite();
const db = drizzle(client);
const ctx = {
  db: db as unknown as CoreCtx['db'],
  tenantId: 'fixture-org',
  profileId: 'fixture-profile',
} as CoreCtx;
const locals = { user: { id: 'fixture-user', supabaseId: 'fixture-profile' } } as App.Locals;
const OWN = '10000000-0000-4000-8000-000000000001';
const FOREIGN = '10000000-0000-4000-8000-000000000002';
const MISSING = '10000000-0000-4000-8000-000000000003';
const DEF = {
  id: 'prop-room',
  tableId: 'scheduling.bookings',
  label: 'Room',
  type: 'select',
  rules: { type: 'select', options: [] },
  version: 1,
  archivedAt: null,
} as unknown as CustomPropertyDefinition;
const cell = (recordId: string) => ({
  propertyId: DEF.id,
  recordId,
  present: true,
  value: 'opt-a',
  effectiveValue: 'opt-a',
  version: 3,
  updatedAt: null,
});

beforeAll(async () => {
  const config = getTableConfig(schedBookings);
  await client.exec(
    `CREATE TABLE "${config.name}" (${config.columns.map((c) => `"${c.name}" ${c.getSQLType()}`).join(',')})`,
  );
  const start = new Date('2026-10-07T14:00:00Z');
  const end = new Date('2026-10-07T15:00:00Z');
  for (const [id, org] of [
    [OWN, 'fixture-org'],
    [FOREIGN, 'other-org'],
  ]) {
    await client.query(
      'INSERT INTO sched_bookings (id,org_id,uid,event_type_id,resource_id,start_time,end_time,status,title,metadata) VALUES ($1::uuid,$2,($1::uuid)::text,$3,$4,$5,$6,$7,$8,$9)',
      [
        id,
        org,
        '30000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        start,
        end,
        'accepted',
        'Fixture',
        '{}',
      ],
    );
  }
});
afterAll(() => client.close());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.moduleEnabled.mockResolvedValue(true);
  mocks.grants = new Set();
  mocks.readValues.mockImplementation(async (_ctx, _tableId, recordIds: string[]) =>
    Object.fromEntries(recordIds.map((id) => [id, { [DEF.id]: cell(id) }])),
  );
});

async function query(ids: string[]) {
  const request = new Request('http://localhost/api/tables/properties/values/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tableId: 'scheduling.bookings', recordIds: ids }),
  });
  const response = await queryValues({ locals, request } as never);
  return response.json() as Promise<{
    values: Record<string, Record<string, unknown>>;
    recordAccess: Record<string, { canEdit: boolean }>;
    canEdit: boolean;
  }>;
}

describe('scheduling.bookings record authorization over sched_bookings', () => {
  it('scheduling editor: own row with canEdit, foreign and missing rows omitted', async () => {
    mocks.grants = new Set(['scheduling:view', 'scheduling:edit']);
    await expect(
      authorizeCustomPropertyRecords(
        locals,
        ctx,
        'scheduling.bookings',
        [OWN, FOREIGN, MISSING],
        'view',
      ),
    ).resolves.toEqual({ [OWN]: { canEdit: true } });
    await expect(
      authorizeCustomPropertyRecords(locals, ctx, 'scheduling.bookings', [OWN, FOREIGN], 'edit'),
    ).resolves.toEqual({ [OWN]: { canEdit: true } });
  });

  it('view-only staff: own row read-only; an edit request yields nothing', async () => {
    mocks.grants = new Set(['scheduling:view']);
    await expect(
      authorizeCustomPropertyRecords(locals, ctx, 'scheduling.bookings', [OWN, FOREIGN], 'view'),
    ).resolves.toEqual({ [OWN]: { canEdit: false } });
    await expect(
      authorizeCustomPropertyRecords(locals, ctx, 'scheduling.bookings', [OWN], 'edit'),
    ).resolves.toEqual({});
  });

  it('a persona without scheduling or POS read is denied every record', async () => {
    mocks.grants = new Set(['crm:view', 'crm:edit', 'stock:view']);
    await expect(
      authorizeCustomPropertyRecords(locals, ctx, 'scheduling.bookings', [OWN], 'view'),
    ).resolves.toEqual({});
  });

  it('POS-only cashier reaches the same row through the alt module', async () => {
    mocks.grants = new Set(['pos:view', 'pos:edit']);
    await expect(
      authorizeCustomPropertyRecords(locals, ctx, 'scheduling.bookings', [OWN, FOREIGN], 'view'),
    ).resolves.toEqual({ [OWN]: { canEdit: true } });
  });

  it('scheduling module disabled: denied even with the capability', async () => {
    mocks.grants = new Set(['scheduling:view', 'scheduling:edit']);
    mocks.moduleEnabled.mockResolvedValue(false);
    await expect(
      authorizeCustomPropertyRecords(locals, ctx, 'scheduling.bookings', [OWN], 'view'),
    ).resolves.toEqual({});
  });
});

describe('POST /api/tables/properties/values/query for scheduling.bookings', () => {
  it('view-only staff: the value comes back with canEdit false; foreign rows are absent', async () => {
    mocks.grants = new Set(['scheduling:view']);
    const bundle = await query([OWN, FOREIGN]);
    expect(bundle.recordAccess).toEqual({ [OWN]: { canEdit: false } });
    expect(Object.keys(bundle.values)).toEqual([OWN]);
    expect(bundle.values[OWN][DEF.id]).toMatchObject({ value: 'opt-a' });
    expect(bundle.canEdit).toBe(false);
    // The value reader only ever sees authorized ids.
    expect(mocks.readValues.mock.calls.map((call) => call[2])).toEqual([[OWN]]);
  });

  it('denied persona: no records, no values, and the value reader is never asked', async () => {
    mocks.grants = new Set(['crm:view']);
    const bundle = await query([OWN, FOREIGN]);
    expect(bundle.recordAccess).toEqual({});
    expect(bundle.values).toEqual({});
    expect(mocks.readValues).not.toHaveBeenCalled();
  });

  it('editor: value with canEdit true', async () => {
    mocks.grants = new Set(['scheduling:view', 'scheduling:edit']);
    const bundle = await query([OWN]);
    expect(bundle.recordAccess).toEqual({ [OWN]: { canEdit: true } });
    expect(bundle.canEdit).toBe(true);
  });
});
