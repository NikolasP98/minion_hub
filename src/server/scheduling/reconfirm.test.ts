import { describe, expect, it } from 'vitest';
import { CONFIDENCE_MIN, acted, caseTitle, casePhase, waitUntil, whenText } from './reconfirm';

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
    ['send_failed', 'No se pudo escribir al cliente'],
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
