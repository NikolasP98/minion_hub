import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

const usage = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('$server/ai-usage', async (orig) => ({
  ...(await orig<object>()),
  recordAiUsage: (...a: unknown[]) => usage.record(...a),
}));

import {
  reminderTemplate,
  composeReminder,
  inferConfirmationReply,
  reconfirmAskTemplate,
  inferReconfirmAnswer,
  offerTemplate,
  confirmTemplate,
  closingTemplate,
} from './reminder-compose';
import type { ReminderContext } from './reminder-compose';

const base: ReminderContext = {
  stage: 'confirmation',
  attendeeName: 'María',
  serviceTitle: 'Botox',
  staffName: 'Dra. Renzo',
  whenText: 'viernes 20 de junio, 03:00 p. m.',
  fromName: 'FACES',
  locale: 'es',
};

describe('reminderTemplate', () => {
  it('includes name, service, staff, when and business for confirmation', () => {
    const t = reminderTemplate(base);
    expect(t).toContain('María');
    expect(t).toContain('Botox');
    expect(t).toContain('Dra. Renzo');
    expect(t).toContain('FACES');
    expect(t).toContain('viernes 20 de junio');
  });

  it('uses distinct copy per stage', () => {
    const conf = reminderTemplate({ ...base, stage: 'confirmation' });
    const h24 = reminderTemplate({ ...base, stage: '24h' });
    const h2 = reminderTemplate({ ...base, stage: '2h' });
    expect(conf).not.toBe(h24);
    expect(h24).toContain('mañana');
    expect(h2).toContain('hoy');
  });

  it('handles missing name and staff gracefully', () => {
    const t = reminderTemplate({ ...base, attendeeName: null, staffName: null });
    expect(t).toContain('Hola 👋');
    expect(t).toContain('Botox');
    expect(t).not.toContain('con ');
  });
});

describe('composeReminder', () => {
  it('returns the template verbatim when personalize is off', async () => {
    const text = await composeReminder(base, false);
    expect(text).toBe(reminderTemplate(base));
  });
});

describe('inferConfirmationReply (spec 139)', () => {
  const about = {
    serviceTitle: 'Botox',
    whenText: 'viernes 20',
    locale: 'es',
    reminderText: 'Te recordamos tu cita de Botox. ¿Confirmas?',
  };
  const answer = (verdict: string, probs: Record<string, number>) => ({
    answers: { verdict: { choice: verdict, probabilities: probs } },
    usage: { cost: 0.0004 },
  });
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    usage.record.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env.OPENROUTER_API_KEY = 'test-key';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_API_KEY;
  });

  it('meters every successful classifier call (a direct fetch bypasses the usage middleware)', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          ...answer('negation', { negation: 0.9, yes: 0.05, unclear: 0.05 }),
          usage: { cost: 0.001, prompt_tokens: 300 },
        }),
      ),
    );
    await inferConfirmationReply(['no voy'], about);
    expect(usage.record).toHaveBeenCalledTimes(1);
    expect(usage.record.mock.calls[0]![0]).toMatchObject({ model: '~typesafe/jev-latest' });
    // The provider cost is stored from the raw usage payload.
    expect(usage.record.mock.calls[0]![0].usage.raw).toEqual({ cost: 0.001, prompt_tokens: 300 });
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    await inferConfirmationReply(['no voy'], about);
    expect(usage.record).toHaveBeenCalledTimes(1); // a failed call is not billed
  });

  it('sends the reminder text and the replies as state, one choice over three options', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify(answer('negation', { yes: 0.02, negation: 0.95, unclear: 0.03 })),
      ),
    );
    await inferConfirmationReply(['no voy a poder'], about);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('openrouter.ai');
    const body = JSON.parse(init.body);
    expect(body.state).toContain('Te recordamos tu cita de Botox');
    expect(body.state).toContain('1. no voy a poder');
    expect(Object.keys(body.questions)).toEqual(['verdict']);
    expect(body.questions.verdict.type).toBe('choice');
    expect(Object.keys(body.questions.verdict.criteria)).toEqual(['yes', 'negation', 'unclear']);
    // "wants to change the date" is a negation, no longer unclear.
    expect(body.questions.verdict.criteria.negation).toContain('change the date');
    expect(body.questions.verdict.criteria.unclear).not.toContain('change the date');
  });

  it('returns the winning option with its probability as the confidence', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify(answer('negation', { yes: 0.02, negation: 0.95, unclear: 0.03 })),
      ),
    );
    const r = await inferConfirmationReply(['no voy a poder'], about);
    expect(r).toMatchObject({ verdict: 'negation', confidence: 0.95, via: 'jev', cost: 0.0004 });
    expect(r.probabilities).toEqual({ yes: 0.02, negation: 0.95, unclear: 0.03 });
  });

  it('falls back to the distribution argmax when the declared choice is not an option', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(answer('maybe', { yes: 0.8, negation: 0.1, unclear: 0.1 }))),
    );
    expect(await inferConfirmationReply(['ok'], about)).toMatchObject({
      verdict: 'yes',
      confidence: 0.8,
    });
  });

  it('is unclear with confidence 0 on no key, no replies, timeout, non-200 and malformed bodies', async () => {
    const unclear = { verdict: 'unclear', confidence: 0, via: 'jev' };
    fetchMock.mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'));
    expect(await inferConfirmationReply(['no'], about)).toEqual(unclear);
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    expect(await inferConfirmationReply(['no'], about)).toEqual(unclear);
    fetchMock.mockResolvedValueOnce(new Response('not json'));
    expect(await inferConfirmationReply(['no'], about)).toEqual(unclear);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ answers: { verdict: {} } })));
    expect(await inferConfirmationReply(['no'], about)).toEqual(unclear);
    expect(await inferConfirmationReply([], about)).toEqual(unclear);
    delete process.env.OPENROUTER_API_KEY;
    fetchMock.mockClear();
    expect(await inferConfirmationReply(['no'], about)).toEqual(unclear);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('reconfirmAskTemplate (spec 139)', () => {
  const ctx: ReminderContext = {
    ...base,
    stage: 'reconfirm',
    attendeeName: 'Ana',
    serviceTitle: 'Afinamiento Facial',
    whenText: 'jueves 27/11 a las 17:15',
    fromName: 'FACES',
  };
  it('names the client, service, date and business, asks the open question, leaves no placeholder', () => {
    const t = reconfirmAskTemplate(ctx);
    expect(t).toBe(
      'Hola Ana. Entiendo que no podrás venir el jueves 27/11 a las 17:15 a tu cita de Afinamiento Facial en FACES. ¿Prefieres que te busquemos otra fecha (dime qué día y a qué hora te acomoda), o no deseas continuar con la cita?',
    );
    expect(t).not.toMatch(/undefined|null|\{|\}/);
    expect(t.length).toBeLessThan(600);
  });
  it('promises nothing: no cancel wording', () => {
    expect(reconfirmAskTemplate(ctx)).not.toMatch(/cancel/i);
    expect(reconfirmAskTemplate({ ...ctx, locale: 'en' })).not.toMatch(/cancel/i);
  });
  it('has an English version and copes with a missing name', () => {
    const t = reconfirmAskTemplate({ ...ctx, locale: 'en', attendeeName: null });
    expect(t.startsWith('Hi. I understand')).toBe(true);
    expect(t).toContain('Afinamiento Facial');
    expect(t).toContain('FACES');
  });
});

describe('inferReconfirmAnswer (spec 139 S4)', () => {
  const about = {
    serviceTitle: 'Botox',
    whenText: 'viernes 20/06 a las 10:00',
    locale: 'es',
    agentText: 'Hola. ¿Prefieres otra fecha?',
    offered: [] as string[],
  };
  const choice = (c: string, p = 0.95) => ({ choice: c, probabilities: { [c]: p } });
  const body = (answers: Record<string, unknown>) =>
    new Response(JSON.stringify({ answers, usage: { cost: 0.001, prompt_tokens: 100 } }));
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    usage.record.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env.OPENROUTER_API_KEY = 'k';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_API_KEY;
  });

  it('reads intent, day and part of day, and meters the call', async () => {
    fetchMock.mockResolvedValue(
      body({ intent: choice('other_date'), day: choice('mon'), part_of_day: choice('afternoon') }),
    );
    const r = await inferReconfirmAnswer(['el lunes en la tarde'], about);
    expect(r).toMatchObject({
      verdict: 'other_date',
      day: 'mon',
      partOfDay: 'afternoon',
      pick: null,
    });
    expect(usage.record).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
    expect(Object.keys(sent.questions)).toEqual(['intent', 'day', 'part_of_day']); // no pick without an offer
  });

  it('a pick is only among the offered options, and the move needs both answers to be sure', async () => {
    fetchMock.mockResolvedValue(
      body({
        intent: choice('pick'),
        day: choice('none'),
        part_of_day: choice('none'),
        pick: choice('2', 0.9),
      }),
    );
    const r = await inferReconfirmAnswer(['la 2'], {
      ...about,
      offered: ['lun 01/12 16:00', 'lun 01/12 17:30'],
    });
    expect(r).toMatchObject({
      verdict: 'pick',
      pick: 1,
      day: null,
      partOfDay: null,
      confidence: 0.9,
    });
    fetchMock.mockResolvedValue(
      body({
        intent: choice('pick'),
        day: choice('none'),
        part_of_day: choice('none'),
        pick: choice('none'),
      }),
    );
    const none = await inferReconfirmAnswer(['mmm'], { ...about, offered: ['a', 'b'] });
    expect(none).toMatchObject({ verdict: 'pick', pick: null, confidence: 0 });
    fetchMock.mockResolvedValue(
      body({
        intent: choice('pick'),
        day: choice('none'),
        part_of_day: choice('none'),
        pick: choice('7'),
      }),
    );
    expect((await inferReconfirmAnswer(['7'], { ...about, offered: ['a', 'b'] })).pick).toBeNull();
  });

  it('never throws: no key, failure and garbage are unclear with confidence 0', async () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(await inferReconfirmAnswer(['x'], about)).toMatchObject({
      verdict: 'unclear',
      confidence: 0,
    });
    process.env.OPENROUTER_API_KEY = 'k';
    fetchMock.mockResolvedValue(new Response('no', { status: 500 }));
    expect(await inferReconfirmAnswer(['x'], about)).toMatchObject({
      verdict: 'unclear',
      confidence: 0,
    });
    fetchMock.mockResolvedValue(body({ intent: 'garbage' }));
    expect(await inferReconfirmAnswer(['x'], about)).toMatchObject({
      verdict: 'unclear',
      confidence: 0,
    });
    expect(await inferReconfirmAnswer([], about)).toMatchObject({ confidence: 0 });
  });
});

describe('S4 agent templates', () => {
  it('offer, confirm and the three closings read as approved (es) and exist in en', () => {
    expect(
      offerTemplate({
        locale: 'es',
        staffName: null,
        slots: ['lun 01/12 16:00', 'lun 01/12 17:30'],
      }),
    ).toBe(
      'Tenemos estos horarios con tu especialista: 1) lun 01/12 16:00 2) lun 01/12 17:30. Responde con el número del que prefieras.',
    );
    expect(
      confirmTemplate({ locale: 'es', serviceTitle: 'Botox', whenText: 'lunes 01/12 a las 17:30' }),
    ).toBe('Listo, tu cita de Botox quedó para el lunes 01/12 a las 17:30. ¡Te esperamos!');
    const k = { locale: 'es', fromName: 'FACES', whenText: 'jueves 27/11 a las 17:15' };
    expect(closingTemplate({ kind: 'wants_other_date', ...k })).toBe(
      'Gracias. El equipo de FACES te escribirá para coordinar una nueva fecha.',
    );
    expect(closingTemplate({ kind: 'declined', ...k })).toContain('Le avisamos al equipo de FACES');
    expect(closingTemplate({ kind: 'will_come', ...k })).toBe(
      'Perfecto, mantenemos tu cita del jueves 27/11 a las 17:15. ¡Te esperamos!',
    );
    for (const kind of ['wants_other_date', 'declined', 'will_come'] as const)
      expect(closingTemplate({ kind, ...k, locale: 'en' })).not.toMatch(/cancel|\{|undefined/i);
  });
});
