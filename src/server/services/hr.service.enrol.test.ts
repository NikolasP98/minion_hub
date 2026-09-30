import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import { schedResources, schedSchedules, schedAvailability } from '$server/db/pg-scheduling-schema';

// emitHubEvent / modules aren't touched by enrolEmployee, but hr.service imports
// leave-rules (pure) only — no extra mocks needed beyond the db itself.
import { enrolEmployee } from './hr.service';

beforeEach(() => {
  vi.clearAllMocks();
});

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });

describe('enrolEmployee — reuse branch (profile already bridged to a sched_resources row)', () => {
  it('seeds a default schedule when the reused resource has none (prod 2026-09-30: Milagros, inserted by a staff script)', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'res-1', timezone: 'America/Lima', active: true, profileId: 'prof-1', color: null }], // resource lookup by profileId
      [], // no existing schedule
      [{ id: 'sched-1' }], // insert schedSchedules returning
      [], // insert schedAvailability (no .returning — still consumes an await)
      [{ id: 'emp-1', resourceId: 'res-1' }], // insert hrEmployees returning
    ]);

    const emp = await enrolEmployee(ctx(db), { name: 'Milagros', profileId: 'prof-1' });

    expect(emp.resource).toEqual({ id: 'res-1', active: true, color: null });
    const insertedTables = (db.insert as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(insertedTables).toContain(schedSchedules);
    expect(insertedTables).toContain(schedAvailability);
  });

  it('does NOT seed a second schedule when the reused resource already has one', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'res-1', timezone: 'America/Lima', active: true, profileId: 'prof-1', color: null }], // resource lookup
      [{ id: 'sched-existing' }], // already has a schedule
      [{ id: 'emp-2', resourceId: 'res-1' }], // insert hrEmployees returning
    ]);

    await enrolEmployee(ctx(db), { name: 'Milagros', profileId: 'prof-1' });

    const insertedTables = (db.insert as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(insertedTables).not.toContain(schedSchedules);
    expect(insertedTables).not.toContain(schedAvailability);
    expect(insertedTables).toEqual(expect.arrayContaining([expect.anything()])); // hrEmployees only
    expect(insertedTables.length).toBe(1);
  });

  it('create branch (no existing resource) still seeds the default schedule', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // no resource bridged to this profile
      [{ id: 'res-new', timezone: 'America/Lima' }], // insert schedResources returning
      [{ id: 'sched-1' }], // insert schedSchedules returning
      [], // insert schedAvailability
      [{ id: 'emp-3', resourceId: 'res-new' }], // insert hrEmployees returning
    ]);

    const emp = await enrolEmployee(ctx(db), { name: 'New Staff', profileId: 'prof-2' });

    expect(emp.resource?.id).toBe('res-new');
    const insertedTables = (db.insert as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(insertedTables).toContain(schedResources);
    expect(insertedTables).toContain(schedSchedules);
    expect(insertedTables).toContain(schedAvailability);
  });
});
