import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

const usage = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('$server/ai-usage', async (orig) => ({
  ...(await orig<object>()),
  recordAiUsage: (...a: unknown[]) => usage.record(...a),
}));

import { reminderTemplate, composeReminder, inferConfirmationReply } from './reminder-compose';
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
