import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_MIN,
  acted,
  caseTitle,
  casePhase,
  waitUntil,
  whenText,
  dateWindow,
  pickOfferSlots,
} from './reconfirm';

const v = (verdict: 'yes' | 'negation' | 'unclear', confidence: number) => ({
  verdict,
  confidence,
  via: 'jev' as const,
});

describe('acted', () => {
  it('treats 0.74 as unclear and 0.75 as the verdict', () => {
    expect(CONFIDENCE_MIN).toBe(0.75);
    expect(acted(v('negation', 0.74))).toBe('unclear');
    expect(acted(v('negation', 0.75))).toBe('negation');
    expect(acted(v('yes', 1))).toBe('yes');
  });
});

describe('waitUntil', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  it('waits the configured hours', () => {
    const start = new Date('2026-11-30T12:00:00Z');
    expect(waitUntil(now, start, 24)?.toISOString()).toBe('2026-11-24T12:00:00.000Z');
  });
  it('is capped at 2 h before the start', () => {
    const start = new Date('2026-11-23T20:00:00Z');
    expect(waitUntil(now, start, 24)?.toISOString()).toBe('2026-11-23T18:00:00.000Z');
  });
  it('is null inside 2 h of the start, or after it', () => {
    expect(waitUntil(now, new Date('2026-11-23T13:59:00Z'), 24)).toBeNull();
    expect(waitUntil(now, new Date('2026-11-23T14:00:00Z'), 24)).toBeNull();
    expect(waitUntil(now, new Date('2026-11-23T11:00:00Z'), 24)).toBeNull();
  });
});

describe('casePhase and caseTitle', () => {
  const open = (agentState: string, result: string | null) => ({
    agentState,
    result,
    closedAt: null,
  });
  const closed = (result: string) => ({ agentState: 'done', result, closedAt: new Date() });

  it('a fresh case needs staff and says the client cannot come', () => {
    expect(casePhase(open('none', null))).toBe('staff');
    expect(caseTitle(open('none', null))).toBe('Dijo que no puede asistir');
  });
  it('the agent talking is phase agent', () => {
    for (const s of ['asking', 'offered']) {
      expect(casePhase(open(s, null))).toBe('agent');
      expect(caseTitle(open(s, null))).toBe('El agente está consultando al cliente');
    }
  });
  it.each([
    ['declined', 'No desea continuar'],
    ['wants_other_date', 'Quiere otra fecha'],
    ['no_answer', 'Sin respuesta'],
    ['unclear', 'Respuesta poco clara'],
    ['late_reply', 'Respondió cerca de la hora de la cita'],
    ['send_failed', 'No se confirmó el mensaje al cliente: revisa el chat'],
    ['staff_handling', 'El equipo ya está conversando con el cliente'],
  ])('open result %s is phase staff', (result, title) => {
    expect(casePhase(open('done', result))).toBe('staff');
    expect(caseTitle(open('done', result))).toBe(title);
  });
  it('a case the agent solved is phase done, a case staff closed shows nothing', () => {
    expect(casePhase(closed('rescheduled'))).toBe('done');
    expect(caseTitle(closed('rescheduled'))).toBe('Reprogramada por el agente');
    expect(casePhase(closed('will_come'))).toBe('done');
    expect(caseTitle(closed('will_come'))).toBe('Confirmó que asistirá');
    expect(casePhase(closed('declined'))).toBeNull();
    expect(casePhase({ agentState: 'none', result: null, closedAt: new Date() })).toBeNull();
  });
});

describe('whenText', () => {
  const at = new Date('2026-11-27T22:15:00Z'); // Friday 17:15 in Lima
  it('reads the weekday, date and 24 h time in the resource timezone', () => {
    expect(whenText(at, 'America/Lima', 'es')).toBe('viernes 27/11 a las 17:15');
    expect(whenText(at, 'America/Lima', 'en')).toBe('Friday 11/27 at 17:15');
    expect(whenText(at, 'America/Lima', 'es', true)).toBe('vie 27/11 17:15');
  });
  it('crosses midnight with the timezone, not UTC', () => {
    expect(whenText(new Date('2026-11-28T03:30:00Z'), 'America/Lima', 'es')).toBe(
      'viernes 27/11 a las 22:30',
    );
  });
  it('falls back to the ISO instant for a bad timezone', () => {
    expect(whenText(at, 'Nope/Zone', 'es')).toBe(at.toISOString());
  });
});

describe('dateWindow', () => {
  const lima = 'America/Lima';
  const now = new Date('2026-11-25T15:00:00Z'); // Wednesday 10:00 in Lima
  const keys = (w: { from: Date; to: Date } | null) =>
    w && [
      whenText(w.from, lima, 'es', true),
      whenText(new Date(w.to.getTime() - 1), lima, 'es', true),
    ];
  it('names tomorrow, the day after and the next weekday strictly after today', () => {
    expect(keys(dateWindow('tomorrow', null, now, lima))).toEqual([
      'jue 26/11 00:00',
      'jue 26/11 23:59',
    ]);
    expect(keys(dateWindow('day_after', null, now, lima))![0]).toBe('vie 27/11 00:00');
    expect(keys(dateWindow('mon', null, now, lima))![0]).toBe('lun 30/11 00:00');
    expect(keys(dateWindow('wed', null, now, lima))![0]).toBe('mié 02/12 00:00'); // not today
  });
  it('next week is next Monday to Sunday; a bare part of day searches 14 days', () => {
    expect(keys(dateWindow('next_week', null, now, lima))).toEqual([
      'lun 30/11 00:00',
      'dom 06/12 23:59',
    ]);
    expect(keys(dateWindow(null, 'morning', now, lima))).toEqual([
      'jue 26/11 00:00',
      'mié 09/12 23:59',
    ]);
  });
  it('nothing named: null', () => {
    expect(dateWindow(null, null, now, lima)).toBeNull();
  });
});

describe('pickOfferSlots', () => {
  const lima = 'America/Lima';
  const at = (h: number, m = 0) => {
    const d = new Date(Date.UTC(2026, 11, 1, h + 5, m)); // Lima = UTC-5
    return { start: d, end: new Date(d.getTime() + 1_800_000), resourceIds: ['r1'] };
  };
  const now = new Date('2026-11-25T15:00:00Z');
  it('keeps only the part of day: morning < 12, afternoon 12-18, evening 18+', () => {
    const slots = [at(9), at(12), at(17, 30), at(18), at(20)];
    expect(
      pickOfferSlots(slots, 'morning', lima, 3, now).map((s) => s.start.getUTCHours() - 5),
    ).toEqual([9]);
    expect(pickOfferSlots(slots, 'afternoon', lima, 3, now)).toHaveLength(2);
    expect(pickOfferSlots(slots, 'evening', lima, 3, now)).toHaveLength(2);
  });
  it('returns at most three, spread first / middle / last', () => {
    const slots = [9, 10, 11, 12, 13, 14, 15].map((h) => at(h));
    const out = pickOfferSlots(slots, null, lima, 3, now).map((s) => s.start.getUTCHours() - 5);
    expect(out).toEqual([9, 12, 15]);
  });
  it('never offers anything sooner than now + 2 h', () => {
    const soon = {
      start: new Date(now.getTime() + 3_600_000),
      end: new Date(now.getTime() + 5_400_000),
      resourceIds: ['r1'],
    };
    expect(pickOfferSlots([soon], null, lima, 3, now)).toEqual([]);
  });
});
