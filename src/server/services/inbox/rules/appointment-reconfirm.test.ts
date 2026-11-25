import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  closeStale: vi.fn(async () => 0),
  cases: [] as unknown[],
  existing: [] as Array<{ dedupeKey: string }>,
  order: [] as string[],
}));
vi.mock('$server/services/reconfirm.service', () => ({
  closeStaleCases: async () => {
    h.order.push('closeStale');
    return h.closeStale();
  },
}));
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: async (_ctx: unknown, fn: (tx: unknown) => unknown) =>
    fn({
      execute: async () => {
        h.order.push('cases');
        return h.cases;
      },
      select: () => ({ from: () => ({ where: async () => h.existing }) }),
    }),
}));

import { appointmentReconfirmRule, reconfirmDraft } from './appointment-reconfirm';
import type { ReconfirmCaseRow } from './appointment-reconfirm';

const ctx = { db: {} as never, tenantId: 'org-1' };
const NOW = new Date('2026-11-23T15:00:00Z');
const base: ReconfirmCaseRow = {
  caseId: 'c1',
  bookingId: 'b1',
  agentState: 'none',
  result: null,
  summary: null,
  closedAt: null,
  startTime: new Date('2026-12-01T01:30:00Z'), // 20:30 on 30 Nov in Lima
  timezone: 'America/Lima',
  serviceTitle: 'Botox',
  attendeeName: 'Ana',
};
const dbRow = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  booking_id: 'b1',
  agent_state: 'none',
  result: null,
  summary: null,
  closed_at: null,
  start_time: '2026-12-01T01:30:00Z',
  timezone: 'America/Lima',
  service_title: 'Botox',
  attendee_name: 'Ana',
  ...over,
});

describe('rescheduled with a failed confirmation', () => {
  const done = { ...base, result: 'rescheduled', closedAt: new Date('2026-11-23T14:00:00Z') };

  it('becomes a staff warning: the client was not told about the new time', () => {
    const d = reconfirmDraft('org-1', { ...done, confirmFailed: true })!;
    expect(d.severity).toBe('warning');
    expect(d.title).toBe('Reprogramada, pero no se pudo avisar al cliente');
    expect(d.dedupeKey).toBe('reconfirm:org-1:c1:done-warn'); // its own key: never loses to the info row
  });

  it('a failed closing message warns too, on its own key', () => {
    const d = reconfirmDraft('org-1', { ...done, result: 'will_come', closingFailed: true })!;
    expect(d.severity).toBe('warning');
    expect(d.title).toBe('Confirmó que asistirá, pero no se pudo avisar al cliente');
    expect(d.dedupeKey).toBe('reconfirm:org-1:c1:done-warn');
  });

  it('stays informational when the confirmation went out', () => {
    const d = reconfirmDraft('org-1', done)!;
    expect(d.severity).toBe('info');
    expect(d.title).toBe('Reprogramada por el agente');
  });

  it('the rule reads the failed confirmation from the events log', async () => {
    h.cases = [
      dbRow({ result: 'rescheduled', closed_at: '2026-11-23T14:00:00Z', confirm_failed: true }),
    ];
    const r = await appointmentReconfirmRule.evaluate(ctx, NOW);
    expect(r.upserts[0]!.title).toBe('Reprogramada, pero no se pudo avisar al cliente');
  });
});

beforeEach(() => {
  h.cases = [];
  h.existing = [];
  h.order = [];
});

describe('reconfirmDraft', () => {
  it('a fresh case is a warning for staff, linking to the appointment day in the resource timezone', () => {
    const d = reconfirmDraft('org-1', base)!;
    expect(d).toMatchObject({
      scope: 'role',
      capability: 'scheduling:manage',
      kind: 'appointment.reconfirm',
      severity: 'warning',
      title: 'Dijo que no puede asistir',
      subjectType: 'sched_booking',
      subjectId: 'b1',
      dedupeKey: 'reconfirm:org-1:c1:staff',
      expiresAt: null,
    });
    expect(d.href).toBe('/scheduling/calendar?date=2026-11-30&booking=b1'); // Lima, not UTC
    expect(d.body).toContain('Botox · Ana');
  });

  it('puts the summary on a second line', () => {
    expect(reconfirmDraft('org-1', { ...base, summary: 'Quiere el lunes' })!.body).toMatch(
      /\nQuiere el lunes$/,
    );
  });

  it('the agent talking is info under the agent phase', () => {
    const d = reconfirmDraft('org-1', { ...base, agentState: 'asking' })!;
    expect(d).toMatchObject({ severity: 'info', dedupeKey: 'reconfirm:org-1:c1:agent' });
  });

  it('a case the agent solved is info under done and expires 48 h after it closed', () => {
    const closedAt = new Date('2026-11-23T10:00:00Z');
    const d = reconfirmDraft('org-1', {
      ...base,
      agentState: 'done',
      result: 'rescheduled',
      closedAt,
    })!;
    expect(d).toMatchObject({
      severity: 'info',
      title: 'Reprogramada por el agente',
      dedupeKey: 'reconfirm:org-1:c1:done',
    });
    expect(d.expiresAt?.toISOString()).toBe('2026-11-25T10:00:00.000Z');
  });

  it('a case staff closed has no notification', () => {
    expect(
      reconfirmDraft('org-1', { ...base, closedAt: new Date(), result: 'declined' }),
    ).toBeNull();
  });
});

describe('appointmentReconfirmRule', () => {
  it('closes stale cases before reading them', async () => {
    await appointmentReconfirmRule.evaluate(ctx, NOW);
    expect(h.order).toEqual(['closeStale', 'cases']);
  });

  it('emits one draft per case', async () => {
    h.cases = [dbRow(), dbRow({ id: 'c2', booking_id: 'b2' })];
    const r = await appointmentReconfirmRule.evaluate(ctx, NOW);
    expect(r.upserts.map((d) => d.dedupeKey)).toEqual([
      'reconfirm:org-1:c1:staff',
      'reconfirm:org-1:c2:staff',
    ]);
    expect(r.resolve).toEqual([]);
  });

  it('resolves the old phase when the case moves on, and keeps the current one', async () => {
    h.cases = [dbRow({ agent_state: 'done', result: 'no_answer' })];
    h.existing = [
      { dedupeKey: 'reconfirm:org-1:c1:agent' },
      { dedupeKey: 'reconfirm:org-1:c1:staff' },
    ];
    const r = await appointmentReconfirmRule.evaluate(ctx, NOW);
    expect(r.upserts.map((d) => d.dedupeKey)).toEqual(['reconfirm:org-1:c1:staff']);
    expect(r.resolve).toEqual(['reconfirm:org-1:c1:agent']);
  });

  it('resolves everything for a case staff closed or whose booking is not live (no row returned)', async () => {
    h.cases = []; // closed cases are not selected
    h.existing = [
      { dedupeKey: 'reconfirm:org-1:c1:staff' },
      { dedupeKey: 'reconfirm:org-1:c1:agent' },
    ];
    const r = await appointmentReconfirmRule.evaluate(ctx, NOW);
    expect(r.upserts).toEqual([]);
    expect(r.resolve.sort()).toEqual(['reconfirm:org-1:c1:agent', 'reconfirm:org-1:c1:staff']);
  });
});
